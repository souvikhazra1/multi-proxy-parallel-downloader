import { contextBridge, ipcRenderer } from "electron";
import { IDownloadRequest, IElectrnApi } from "./type-defs";

let onDownloadFailCb: ((message: string) => void) | undefined
let onDownloadCompletedCb: (() => void) | undefined

contextBridge.exposeInMainWorld('electronApi', {
    startDownload: (urls: IDownloadRequest[], location: string) => ipcRenderer.invoke('download:start', urls, location),
    downloadStatus: () => ipcRenderer.invoke('download:status'),
    onDownloadFail: (cb?: (message: string) => void) => {
        if (onDownloadFailCb) {
            ipcRenderer.off('download:fail', onDownloadFailCb);
        }
        onDownloadFailCb = cb;
        if (cb) {
            ipcRenderer.on('download:fail', (_e, message) => cb(message));
        }
    },
    onDownloadCompleted: (cb?: () => void) => {
        if (onDownloadCompletedCb) {
            ipcRenderer.off('download:complete', onDownloadCompletedCb);
        }
        onDownloadCompletedCb = cb;
        if (cb) {
            ipcRenderer.on('download:complete', () => cb());
        }
    },
    showErrorMessage: (msg) => ipcRenderer.send('msg:error', msg),
    showInfoMessage: (msg) => ipcRenderer.send('msg:info', msg),
    setProgress: (progress) => ipcRenderer.send('progress', progress),
    getNetworkInterfaces: () => ipcRenderer.invoke('network_interfaces'),
    stopDownload: () => ipcRenderer.send('download:stop')
} as IElectrnApi);