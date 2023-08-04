import { MDBBtn, MDBCol, MDBContainer, MDBInput, MDBNavbar, MDBNavbarBrand, MDBProgressBar, MDBRange, MDBRow, MDBTextArea } from 'mdb-react-ui-kit';
import { useEffect, useState } from 'react';
import { IDownloadInfo, IDownloadRequest, IElectrnApi, INetworkInterface } from '../electron/type-defs';
import './App.scss';

interface ICustomWindow extends Window {
  electronApi: IElectrnApi;
}

interface IDownloadFormElement extends IDownloadRequest {
  idx: number;
  niIdx: number;
}

declare var window: ICustomWindow;
const DOWNLOADER_COUNT = parseInt(localStorage.getItem('downloadCount') ?? '0') || 50;
const PROXY_START = parseInt(localStorage.getItem('proxyStart') ?? '0') || 9050;
const NI_TOR = 999;

const generateFormData = (downloadCount: number, proxyStart: number) => Array.from({
  length: downloadCount
}, (_v, i) => {
  localStorage.setItem('downloadCount', downloadCount.toString());
  localStorage.setItem('proxyStart', proxyStart.toString());
  return {
    percent: 100 / downloadCount,
    url: '',
    idx: i,
    proxy: {
      host: '127.0.0.1',
      port: (proxyStart + i).toString()
    },
    niIdx: NI_TOR
  };
});

const App: React.FC = () => {
  const [downloadStatus, setDownloadStatus] = useState<IDownloadInfo[]>([]);
  const [nis, setNis] = useState<INetworkInterface[]>([]);
  const [formData, setFormData] = useState<IDownloadFormElement[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadCount, setDownloadCount] = useState<number>(DOWNLOADER_COUNT);
  const [proxyStart, setProxyStart] = useState<number>(PROXY_START);

  useEffect(() => {
    let interval: NodeJS.Timer | undefined;
    if (downloading) {
      window.electronApi.downloadStatus().then((d) => setDownloadStatus(d));
      interval = setInterval(() => {
        window.electronApi.downloadStatus().then((d) => setDownloadStatus(d));
      }, 1000);
    } else {
      window.electronApi.setProgress(0);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    }
  }, [downloading]);

  useEffect(() => {
    window.electronApi.onDownloadCompleted(() => {
      window.electronApi.showInfoMessage('Download Completed');
      window.location.reload();
    });
    window.electronApi.onDownloadFail((msg) => {
      window.electronApi.showErrorMessage(`Download Failed: ${msg}`);
      setDownloading(false);
    });
    window.electronApi.getNetworkInterfaces().then(nis => {
      setNis(nis);
      setFormData(generateFormData(DOWNLOADER_COUNT, PROXY_START));
    });

    return () => {
      window.electronApi.onDownloadCompleted();
      window.electronApi.onDownloadFail();
    }
  }, []);

  const urlChangeHandler = (idx: number, e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.currentTarget.value.trim();
    setFormData((oldVal) => {
      oldVal[idx].url = val;
      return [...oldVal];
    });
  }

  const fillAllHandler = () => {
    setFormData((oldData) => {
      if (oldData[0].url) {
        oldData.forEach(d => d.url = oldData[0].url);
      }
      return [...oldData];
    });
  }

  const clearhandler = () => {
    setFormData((oldData) => {
      oldData.forEach(d => d.url = '');
      return [...oldData];
    });
  }

  const startDownloadHandler = async () => {
    if (formData.find(d => !d.url)) {
      window.electronApi.showErrorMessage('Enter all URLs');
      return;
    }
    const url = formData[0].url;
    const fName = decodeURIComponent(url.split('/').pop()?.split('#')[0].split('?')[0] ?? '');
    formData.forEach(f => {
      if (f.niIdx !== NI_TOR) {
        f.proxy.port = f.niIdx.toString();
      }
    })
    const status = await window.electronApi.startDownload(formData, fName);
    if (status) {
      setDownloading(true);
    } else {
      window.electronApi.showErrorMessage('Failed to start download');
    }
  };

  const toDisplayBytes = (bytes: number) => {
    let val = bytes;
    let unit = 'B';
    if (val > 1024) {
      val /= 1024;
      unit = 'KB';
    }
    if (val > 1024) {
      val /= 1024;
      unit = 'MB';
    }
    if (val > 1024) {
      val /= 1024;
      unit = 'GB';
    }

    return `${val.toFixed(2)} ${unit}`;
  }

  const toDisplayTime = (seconds: number) => {
    let sec = Math.round(seconds);
    const hour = Math.floor(sec / 3600);
    sec %= 3600;
    const min = Math.floor(sec / 60);
    sec %= 60;

    return `${('0' + hour).slice(-2)}:${('0' + min).slice(-2)}:${('0' + sec).slice(-2)}`;
  };

  const percentageChangeHandler = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.currentTarget.value);
    setFormData((oldVal) => {
      oldVal[idx].percent = val;
      const rest = idx === 0 ? ((100 - val) / (oldVal.length - 1)) : ((100 - val - oldVal[0].percent) / (oldVal.length - 2));
      oldVal.forEach((v, i) => {
        if (i > 0 && i !== idx) {
          v.percent = rest;
        }
      })
      return [...oldVal];
    });
  }

  let totalSize = 0;
  let totalDownloaded = 0;
  let totalSpeed = 0;
  let totalProgress = 0;
  let eta = 0;
  if (downloading) {
    downloadStatus.forEach(status => {
      totalSize += status.totalBytes;
      totalDownloaded += status.downloadedBytes;
      totalSpeed += status.speed;
    });
    totalProgress = Math.round(totalDownloaded / totalSize * 100);
    window.electronApi.setProgress(totalProgress);
    eta = totalSpeed > 0 ? ((totalSize - totalDownloaded) / totalSpeed) : 0;
  }

  const getProgressColor = (download: IDownloadInfo) => {
    if (download.worstConnection) {
      return 'warning';
    }
    if (download.shifted) {
      return 'success';
    }
    return 'primary';
  }

  const connChangeHandler = (idx: number, e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = parseInt(e.currentTarget.value.toString());
    setFormData((oldVal) => {
      oldVal[idx].niIdx = val;
      return [...oldVal];
    });
  }

  const stopDownload = () => {
    const confirm = window.confirm('Are you sure to stop download?');
    if (confirm) {
      window.electronApi.stopDownload()
    }
  };

  return (
    <>
      <MDBNavbar sticky dark>
        <MDBContainer fluid>
          <MDBNavbarBrand href='#'>
            Multi Proxy Parallel Downloader
          </MDBNavbarBrand>
          {!downloading && (
            <div>
              <MDBBtn color='warning' outline className='me-2' onClick={clearhandler}>Clear</MDBBtn>
              <MDBBtn onClick={fillAllHandler}>Fill All</MDBBtn>
            </div>
          )}
          {downloading && (
            <div>
              <MDBBtn color='danger' onClick={stopDownload}>Stop</MDBBtn>
            </div>
          )}
        </MDBContainer>
      </MDBNavbar>
      <MDBContainer fluid className='mb-6 mt-4'>
        {!downloading && (
          <>
            <MDBRow className='mb-4'>
              <MDBCol>
                <MDBInput label='Number of Connection' contrast value={downloadCount} onChange={(e) => setDownloadCount(parseInt(e.currentTarget.value.trim()))} />
              </MDBCol>
              <MDBCol>
                <MDBInput label='Proxy Starting Port' contrast value={proxyStart} onChange={(e) => setProxyStart(parseInt(e.currentTarget.value.trim()))} />
              </MDBCol>
              <MDBCol style={{ flex: 0 }}>
                <MDBBtn onClick={() => setFormData(generateFormData(downloadCount, proxyStart))}>Set</MDBBtn>
              </MDBCol>
            </MDBRow>
            <MDBRow>
              {formData.map((req, idx) => (
                <MDBCol lg={6} xxl={4} className='mb-4' key={req.idx}>
                  <MDBTextArea label={`Download Link ${req.idx + 1}`} rows={3} value={req.url} onChange={urlChangeHandler.bind(null, idx)} className='mb-3' contrast />
                  <select className='form-select text-white mb-2' value={req.niIdx} onChange={connChangeHandler.bind(null, idx)}>
                    {nis.map((ni, idx) => <option value={idx} key={ni.name}>{ni.name}</option>)}
                    <option value={NI_TOR}>{`Tor ${req.proxy.port}`}</option>
                  </select>
                  <MDBRange className='mh-2' label={`Download Percentage (${req.percent.toFixed(2)}%)`} value={req.percent} onChange={percentageChangeHandler.bind(null, idx)} />
                </MDBCol>
              ))}
              <div className="footer">
                <MDBContainer fluid>
                  <MDBBtn onClick={startDownloadHandler}>Start Download</MDBBtn>
                </MDBContainer>
              </div>
            </MDBRow>
          </>
        )}
        {downloading && (
          <MDBRow>
            <MDBCol size={12} className='mb-6'>
              <MDBProgressBar valuemin={0} valuemax={100} width={totalProgress} className='mb-1' bgColor='info'>
                {totalProgress}%
              </MDBProgressBar>
              {toDisplayBytes(totalDownloaded)}/{toDisplayBytes(totalSize)} ({toDisplayBytes(totalSpeed)}/s)
              <span className='float-end'>ETA: {toDisplayTime(eta)}</span>
            </MDBCol>
            {downloadStatus.map((status, idx) => (
              <MDBCol lg={6} xxl={4} className='mb-4' key={idx}>
                <MDBProgressBar valuemin={0} valuemax={100} width={status.progress} className='mb-1' bgColor={getProgressColor(status)}>
                  <small>{status.progress}%</small>
                </MDBProgressBar>
                <small>{toDisplayBytes(status.downloadedBytes)}/{toDisplayBytes(status.totalBytes)} ({toDisplayBytes(status.speed)}/s)</small>
              </MDBCol>
            ))}
          </MDBRow>
        )}
      </MDBContainer>
    </>
  )
}

export default App;
