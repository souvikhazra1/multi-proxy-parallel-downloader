export interface IDownloadRequest {
    url: string;
    proxy: {
        host: string,
        port: string
    },
    percent: number
}

export interface IDownloadInfo extends IDownloadRequest {
    fromBytes: number;
    toBytes: number;
    totalBytes: number;
    downloadedBytes: number;
    progress: number;
    speed: number;
    destination: string;
    shifted: boolean;
    worstConnection: boolean;
}

export interface INetworkInterface {
    address: string;
    name: string;
}

export interface IElectrnApi {
    startDownload: (urls: IDownloadRequest[], location: string) => Promise<boolean>;
    downloadStatus: () => Promise<IDownloadInfo[]>;
    onDownloadFail: (cb?: (message: string) => void) => void;
    onDownloadCompleted: (cb?: () => void) => void;
    showInfoMessage: (msg: string) => void;
    showErrorMessage: (msg: string) => void;
    setProgress: (progress: number) => void;
    getNetworkInterfaces: () => Promise<INetworkInterface[]>;
    stopDownload: () => void;
}