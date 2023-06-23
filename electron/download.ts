import axios, { AxiosRequestConfig } from "axios";
import { BrowserWindow } from "electron";
import fs, { ReadStream, createReadStream, createWriteStream } from 'fs';
import https from 'https';
import os from 'os';
import { SocksProxyAgent } from "socks-proxy-agent";
import stream from "stream";
import { promisify } from "util";
import { IDownloadInfo, IDownloadRequest, INetworkInterface } from "./type-defs";

const finished = promisify(stream.finished);

const READ_TIME_OUT = 300000; // 5 mins

axios.defaults.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0';

const finishedPorts: string[] = [];
const dumpedPorts: string[] = [];
const avgPortSpeed: { [key: string]: number } = {};
let niPortMap: { [key: string]: string } = {};

let downloads: IDownloadInfo[] = [];
let downloadLoc = '';
let mainWindow: BrowserWindow | undefined;
let failed = false;
let stopped = false;

/**
 * Get all network interfaces
 */
export const getNetworkInterfaces = () => {
    niPortMap = {};
    let port = 0;
    const nis = os.networkInterfaces();
    const interfaces: INetworkInterface[] = [];
    Object.keys(nis).forEach(k => {
        if (k === 'lo') {
            return;
        }
        const ni = nis[k] ?? [];
        ni.forEach(ip => {
            if (ip.family === 'IPv4' && !ip.internal) {
                interfaces.push({
                    address: ip.address,
                    name: k
                });
                niPortMap[port.toString()] = ip.address;
                port++;
            }
        });
    });
    return interfaces;
}

/**
 * Prepare download chunks and call download
 */
export const startDownload = async (requests: IDownloadRequest[], location: string) => {
    const url = requests[0].url;
    let contentLength = 0
    try {
        const resp = await axios.head(url);
        contentLength = (resp.headers["content-length"]?.valueOf() ?? 0) as number;
    } catch (e) {
        console.log(e);
    }
    if (contentLength <= 0) {
        return false;
    }
    downloads = [];
    let bytesCovered = 0;
    let idx = 0;
    for (const request of requests) {
        const totalBytes = Math.floor(contentLength * request.percent / 100);
        const toBytes = bytesCovered + totalBytes;
        downloads.push({
            ...request,
            downloadedBytes: 0,
            fromBytes: bytesCovered,
            toBytes,
            totalBytes,
            progress: 0,
            speed: 0,
            destination: `${location}.part${idx++}`,
            shifted: false,
            worstConnection: false,
        });
        bytesCovered = toBytes;
        avgPortSpeed[request.proxy.port] = 0;
    }
    const lastDownload = downloads[downloads.length - 1];
    lastDownload.toBytes = contentLength;
    lastDownload.totalBytes = contentLength - lastDownload.fromBytes;

    downloadLoc = location;

    download();

    return true;
};

export const stopDownload = async () => {
    stopped = true;
}

/**
 * Check if main connection or tor connection
 */
const isMainConnection = (port: string) => port.length < 4;

/**
 * Find the idle connection with highest avg speed
 */
const findBestIdleConnection = (p: string) => {
    const avgSpeeds = { ...avgPortSpeed };
    const ports = Object.keys(avgSpeeds).filter(k => k !== p && !dumpedPorts.includes(k) && finishedPorts.includes(k));
    let bestSpeed = {
        port: '',
        speed: avgSpeeds[p]
    };
    for (const port of ports) {
        if (p !== port && avgSpeeds[port] > bestSpeed.speed) {
            bestSpeed.port = port;
            bestSpeed.speed = avgSpeeds[port];
        }
    }
    return bestSpeed.port;
};

/**
 * Is the current connection is worst
 */
const isWorstConnection = (port: string) => {
    const avgSpeeds = { ...avgPortSpeed };
    const ports = Object.keys(avgSpeeds);
    return !ports.find(k => k !== port && !dumpedPorts.includes(k) && !finishedPorts.includes(k) && avgSpeeds[k] < avgSpeeds[port])
};

/**
 * Sleep amount of ms
 */
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(() => {
    resolve();
}, ms));

/**
 * Download the file part using 1 single connection
 */
const downloadPart = async (download: IDownloadInfo) => {
    let lastRead = Date.now();
    let progressInterval: NodeJS.Timer | undefined;
    let data: ReadStream | undefined;
    let shiftDownload = false;
    let betterPort = '';
    const lastDownloaded = download.downloadedBytes;

    if (!download.shifted && fs.existsSync(download.destination)) {
        fs.rmSync(download.destination);
    }
    const writer = createWriteStream(download.destination, {
        flags: download.shifted ? 'a' : 'w'
    });
    const config: AxiosRequestConfig = {
        responseType: 'stream',
        headers: {
            Range: `bytes=${download.fromBytes + lastDownloaded}-${download.toBytes - 1}`
        }
    };
    let axiosInstance = axios.create();
    if (isMainConnection(download.proxy.port)) {
        const ip = niPortMap[download.proxy.port];
        console.log('ip', ip);
        axiosInstance = axios.create({
            transport: {
                ...https,
                request: (options, callback) => https.request({
                    ...options,
                    localAddress: ip,
                }, callback),
            },
        });
    } else {
        const agent = new SocksProxyAgent(`socks://${download.proxy.host}:${download.proxy.port}`);
        config.httpAgent = agent;
        config.httpsAgent = agent;
    }

    const onDataCb = () => {
        lastRead = Date.now();
    }
    const onErrorCb = () => {
        shiftDownload = true;
        console.log('Data read error on', download.proxy.port);
    };

    try {
        const resp = await axiosInstance.get<ReadStream>(download.url, config);
        data = resp.data;
        data.pipe(writer);

        data.on('error', onErrorCb);
        data.on('data', onDataCb);

        const downloadArr: number[] = []; // to hold 10 data points to calculate avg
        progressInterval = setInterval(() => {
            if (stopped) {
                failed = true;
                writer.close();
                return;
            }
            if (downloadArr.length === 5) {
                downloadArr.splice(0, 1);
            }

            const bytesWritten = lastDownloaded + writer.bytesWritten;
            const bytesWrittenNow = bytesWritten - download.downloadedBytes;
            downloadArr.push(bytesWrittenNow);
            download.downloadedBytes = bytesWritten;
            download.progress = Math.round(download.downloadedBytes / download.totalBytes * 100);
            // avg of 10 data points
            download.speed = downloadArr.reduce((a, b) => a + b, 0) / downloadArr.length;
            if (bytesWrittenNow > 0) {
                // don't calculate avg speed for stale connection
                avgPortSpeed[download.proxy.port] = avgPortSpeed[download.proxy.port] ? (avgPortSpeed[download.proxy.port] + download.speed) / 2 : download.speed;
            }

            download.worstConnection = isWorstConnection(download.proxy.port);
            betterPort = download.worstConnection ? findBestIdleConnection(download.proxy.port) : '';
            if (betterPort) {
                console.log('betterPort', download.proxy.port, betterPort);
                // better free connection is available shift to that
                shiftDownload = true;
                // remove port from finished ports
                const finishedPortIdx = finishedPorts.indexOf(betterPort);
                if (finishedPortIdx >= 0) {
                    finishedPorts.splice(finishedPortIdx, 1);
                }
                writer.close();
            }
            if (Date.now() - lastRead > READ_TIME_OUT) {
                // no data for long time, stop this download
                shiftDownload = true;
                console.log('Data read timeout', download.proxy.port);
            }
            if (shiftDownload) {
                writer.close();
            }
        }, 1000);
        await finished(writer);

        download.downloadedBytes = lastDownloaded + writer.bytesWritten;
        download.progress = Math.round(download.downloadedBytes / download.totalBytes * 100);
        download.speed = 0;

        if (!shiftDownload) {
            finishedPorts.push(download.proxy.port);
        }
    } catch (e) {
        console.log(e);
        shiftDownload = true;
        if (!isMainConnection(download.proxy.port)) {
            // download failed, this connection has gone bad
            dumpedPorts.push(download.proxy.port);
        }
    }
    // clean up
    writer.close();
    if (progressInterval) {
        clearInterval(progressInterval);
    }
    if (onDataCb) {
        data?.off('data', onDataCb);
    }
    data?.off('error', onErrorCb);

    if (shiftDownload) {
        if (!dumpedPorts.includes(download.proxy.port)) {
            finishedPorts.push(download.proxy.port);
        }
        if (dumpedPorts.length === downloads.length) {
            // all connections are gone, fail the download
            failed = true;
        } else {
            // shift to better connection
            if (!betterPort) {
                // find better connection if not already found
                console.log('Waiting for better connection for', download.proxy.port);
                while (!(betterPort = findBestIdleConnection(download.proxy.port))) {
                    await sleep(500);
                }
                console.log('Better connection found', betterPort);
                // remove port from finished ports
                const finishedPortIdx = finishedPorts.indexOf(betterPort);
                if (finishedPortIdx >= 0) {
                    finishedPorts.splice(finishedPortIdx, 1);
                }
            }
            download.proxy.port = betterPort;
            download.shifted = true;
            await downloadPart(download);
        }
    }
};

/**
 * Start downloading all the chunks and wait for all of them to complete
 */
const download = () => {
    const allDownloads: Promise<void>[] = [];
    const partFiles: string[] = [];
    failed = false;
    stopped = false;
    downloads.forEach((download) => {
        partFiles.push(download.destination);
        allDownloads.push(downloadPart(download));
    });
    Promise.all(allDownloads).then(async () => {
        if (!failed) {
            if (fs.existsSync(downloadLoc)) {
                fs.rmSync(downloadLoc);
            }
            for (const partFile of partFiles) {
                const writer = createWriteStream(downloadLoc, { flags: 'a' });
                const reader = createReadStream(partFile);
                reader.pipe(writer);
                await finished(writer);
                fs.rmSync(partFile);
                writer.close();
            }

            mainWindow?.webContents.send('download:complete');
        } else {
            for (const partFile of partFiles) {
                if (fs.existsSync(partFile)) {
                    fs.rmSync(partFile);
                }
            }
            mainWindow?.webContents.send('download:fail', stopped ? 'Stopped' : 'Failed');
        }
    });
}

export const downloadStatus = () => downloads;

export const setMainWindow = (win?: BrowserWindow) => {
    mainWindow = win;
}