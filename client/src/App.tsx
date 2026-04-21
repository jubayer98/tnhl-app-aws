import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { fetchReportByTypeAndSample, fetchReportCatalog } from './api/reportApi';
import type {
  ReportCatalogResponse,
  ReportOption,
  ReportSampleData,
  ReportType,
} from './types/report';
import './App.css';

type ViewState = {
  zoom: number;
  minZoom: number;
  maxZoom: number;
  centerX: number;
  centerY: number;
};

type DragState = {
  pointerId: number;
  lastX: number;
  lastY: number;
};

type RouteState =
  | { page: 'home' }
  | { page: 'report'; reportType: ReportType; sampleId: string };

const REPORT_TYPES: ReportType[] = ['argmax', 'astir'];

function isReportType(value: string): value is ReportType {
  return REPORT_TYPES.includes(value as ReportType);
}

function parseRoute(pathname: string): RouteState {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    return { page: 'home' };
  }

  const reportType = parts[0].toLowerCase();
  const sampleId = parts[1];
  if (!isReportType(reportType) || !sampleId) {
    return { page: 'home' };
  }

  return {
    page: 'report',
    reportType,
    sampleId,
  };
}

function App() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute(window.location.pathname));
  const [catalog, setCatalog] = useState<ReportCatalogResponse | null>(null);
  const [homeReportType, setHomeReportType] = useState<ReportType>('argmax');
  const [homeCoreId, setHomeCoreId] = useState('');
  const [report, setReport] = useState<ReportSampleData | null>(null);
  const [selectedPredictionKey, setSelectedPredictionKey] = useState('all');
  const [showMarkerMask, setShowMarkerMask] = useState(false);
  const [showPredictionNumbers, setShowPredictionNumbers] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isScreenBusy, setIsScreenBusy] = useState(true);
  const [busyLabel, setBusyLabel] = useState('Loading report...');
  const [isReportLayoutReady, setIsReportLayoutReady] = useState(false);
  const [reportLoadTimedOut, setReportLoadTimedOut] = useState(false);

  const frameRefs = useRef<HTMLDivElement[]>([]);
  const predictionImageRef = useRef<HTMLImageElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const viewStateRef = useRef<ViewState>({
    zoom: 1,
    minZoom: 0.6,
    maxZoom: 40,
    centerX: 0,
    centerY: 0,
  });

  const selectedPrediction = useMemo<ReportOption | null>(() => {
    if (!report) {
      return null;
    }

    return (
      report.predictionViews.find((view) => view.key === selectedPredictionKey) ||
      report.predictionViews[0] ||
      null
    );
  }, [report, selectedPredictionKey]);

  const selectedTypeCatalog = useMemo(() => {
    if (!catalog) {
      return null;
    }

    return catalog.reportTypes.find((entry) => entry.key === homeReportType) || null;
  }, [catalog, homeReportType]);

  const currentRouteCatalog = useMemo(() => {
    if (!catalog || route.page !== 'report') {
      return null;
    }

    return catalog.reportTypes.find((entry) => entry.key === route.reportType) || null;
  }, [catalog, route]);

  const resolveRelativeImage = useCallback((imagePath: string): string => {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      return imagePath;
    }
    return `${apiBaseUrl}${imagePath}`;
  }, []);

  const navigateTo = useCallback((nextRoute: RouteState, replace = false) => {
    const nextPath =
      nextRoute.page === 'home'
        ? '/'
        : `/${nextRoute.reportType}/${encodeURIComponent(nextRoute.sampleId)}`;

    if (window.location.pathname !== nextPath) {
      if (replace) {
        window.history.replaceState({}, '', nextPath);
      } else {
        window.history.pushState({}, '', nextPath);
      }
    }

    setRoute(nextRoute);
  }, []);

  const preloadImage = useCallback((src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Failed to preload image: ${src}`));
      image.src = src;
    });
  }, []);

  const preloadReportAssets = useCallback(
    async (data: ReportSampleData): Promise<void> => {
      const assets = [
        data.rawProcessedImage,
        data.predictionAllImage,
        data.predictionLegendImage,
        data.predictionNumbersOverlayImage,
        ...data.predictionViews.map((view) => view.image),
        ...data.markerTiles.flatMap((tile) => [tile.image, tile.segmentationOverlay]),
      ];

      const uniqueAssetUrls = Array.from(
        new Set(assets.map((assetPath) => resolveRelativeImage(assetPath))),
      );

      await Promise.all(uniqueAssetUrls.map((asset) => preloadImage(asset)));
    },
    [preloadImage, resolveRelativeImage],
  );

  const getImageDimensions = useCallback((): { iw: number; ih: number } | null => {
    const image = predictionImageRef.current;
    if (!image) {
      return null;
    }

    const iw = image.naturalWidth || image.clientWidth;
    const ih = image.naturalHeight || image.clientHeight;
    if (!iw || !ih) {
      return null;
    }

    return { iw, ih };
  }, []);

  const getReferenceFrame = useCallback((): HTMLDivElement | null => {
    return frameRefs.current[0] || null;
  }, []);

  const getBaseFit = useCallback(
    (frame: HTMLDivElement, dimensions: { iw: number; ih: number }) => {
      const fw = frame.clientWidth;
      const fh = frame.clientHeight;
      if (!fw || !fh) {
        return null;
      }

      return {
        frameWidth: fw,
        frameHeight: fh,
        scale: Math.min(fw / dimensions.iw, fh / dimensions.ih),
      };
    },
    [],
  );

  const clampViewState = useCallback(
    (frame?: HTMLDivElement | null) => {
      const referenceFrame = frame || getReferenceFrame();
      if (!referenceFrame) {
        return;
      }

      const dimensions = getImageDimensions();
      if (!dimensions) {
        return;
      }

      const fit = getBaseFit(referenceFrame, dimensions);
      if (!fit) {
        return;
      }

      const state = viewStateRef.current;
      const scale = fit.scale * state.zoom;
      if (!scale) {
        return;
      }

      const visibleW = fit.frameWidth / scale;
      const visibleH = fit.frameHeight / scale;

      if (visibleW >= dimensions.iw) {
        state.centerX = dimensions.iw / 2;
      } else {
        const halfW = visibleW / 2;
        state.centerX = Math.max(halfW, Math.min(dimensions.iw - halfW, state.centerX));
      }

      if (visibleH >= dimensions.ih) {
        state.centerY = dimensions.ih / 2;
      } else {
        const halfH = visibleH / 2;
        state.centerY = Math.max(halfH, Math.min(dimensions.ih - halfH, state.centerY));
      }
    },
    [getBaseFit, getImageDimensions, getReferenceFrame],
  );

  const applyTransform = useCallback(() => {
    const dimensions = getImageDimensions();
    if (!dimensions) {
      return;
    }

    clampViewState();
    const state = viewStateRef.current;

    frameRefs.current.forEach((frame) => {
      if (!frame) {
        return;
      }

      const fit = getBaseFit(frame, dimensions);
      if (!fit) {
        return;
      }

      const images = Array.from(frame.querySelectorAll<HTMLImageElement>('.sync-image'));
      if (!images.length) {
        return;
      }

      const scale = fit.scale * state.zoom;
      const x = fit.frameWidth / 2 - state.centerX * scale;
      const y = fit.frameHeight / 2 - state.centerY * scale;

      images.forEach((image) => {
        image.style.width = `${dimensions.iw}px`;
        image.style.height = `${dimensions.ih}px`;
        image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      });
    });
  }, [clampViewState, getBaseFit, getImageDimensions]);

  const syncPredictionFrameSize = useCallback(() => {
    const markerFrame = document.querySelector<HTMLDivElement>('.marker-tile .tile-frame');
    const predictionFrame = document.querySelector<HTMLDivElement>('.prediction-frame');
    const predictionPanel = document.querySelector<HTMLElement>('.prediction-panel');
    const predictionStack = document.querySelector<HTMLElement>('.prediction-stack');
    const sidePanel = document.querySelector<HTMLElement>('.side-panel');
    const selectorCard = document.querySelector<HTMLElement>('.selector-card');
    const legendBox = document.getElementById('prediction-legend');

    if (!markerFrame || !predictionFrame || !predictionPanel) {
      return;
    }

    const markerRect = markerFrame.getBoundingClientRect();
    const side = Math.round(Math.min(markerRect.width, markerRect.height));
    if (!side) {
      return;
    }

    predictionFrame.style.width = `${side}px`;
    predictionFrame.style.height = `${side}px`;
    predictionPanel.style.width = `${side}px`;

    if (predictionStack) {
      predictionStack.style.width = `${side}px`;
    }
    if (sidePanel) {
      sidePanel.style.width = `${side}px`;
    }
    if (selectorCard) {
      selectorCard.style.width = `${side}px`;
    }
    if (legendBox) {
      legendBox.style.width = `${side}px`;
      legendBox.style.maxWidth = `${side}px`;
    }
  }, []);

  const resetView = useCallback(() => {
    const state = viewStateRef.current;
    state.zoom = 1;
    const dimensions = getImageDimensions();

    if (!dimensions) {
      state.centerX = 0;
      state.centerY = 0;
      return;
    }

    state.centerX = dimensions.iw / 2;
    state.centerY = dimensions.ih / 2;
    applyTransform();
  }, [applyTransform, getImageDimensions]);

  const zoomAround = useCallback(
    (clientX: number, clientY: number, factor: number, frame: HTMLDivElement) => {
      const dimensions = getImageDimensions();
      if (!dimensions) {
        return;
      }

      const referenceFrame = getReferenceFrame() || frame;
      const fit = getBaseFit(referenceFrame, dimensions);
      if (!fit) {
        return;
      }

      const rect = frame.getBoundingClientRect();
      const localRatioX = rect.width ? (clientX - rect.left) / rect.width : 0.5;
      const localRatioY = rect.height ? (clientY - rect.top) / rect.height : 0.5;
      const localX = Math.max(0, Math.min(1, localRatioX)) * fit.frameWidth;
      const localY = Math.max(0, Math.min(1, localRatioY)) * fit.frameHeight;

      const state = viewStateRef.current;
      const scale = fit.scale * state.zoom;
      const nextZoom = Math.max(state.minZoom, Math.min(state.maxZoom, state.zoom * factor));
      const nextScale = fit.scale * nextZoom;

      const currentX = fit.frameWidth / 2 - state.centerX * scale;
      const currentY = fit.frameHeight / 2 - state.centerY * scale;
      const imageX = (localX - currentX) / scale;
      const imageY = (localY - currentY) / scale;

      state.centerX = imageX - (localX - fit.frameWidth / 2) / nextScale;
      state.centerY = imageY - (localY - fit.frameHeight / 2) / nextScale;
      state.zoom = nextZoom;

      clampViewState(referenceFrame);
      applyTransform();
    },
    [applyTransform, clampViewState, getBaseFit, getImageDimensions, getReferenceFrame],
  );

  const loadCatalog = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setIsScreenBusy(true);
    setBusyLabel('Loading report catalog...');
    setErrorMessage(null);

    try {
      const data = await fetchReportCatalog();
      setCatalog(data);
      setHasLoadedOnce(true);

      const firstAvailableType = data.reportTypes.find((entry) => entry.cores.length > 0);
      if (firstAvailableType) {
        setHomeReportType(firstAvailableType.key);
        setHomeCoreId(firstAvailableType.cores[0] || '');
      }

      if (route.page === 'report') {
        const routeType = data.reportTypes.find((entry) => entry.key === route.reportType);
        const fallbackCore = routeType?.cores[0] || '';
        if (!routeType || !routeType.cores.includes(route.sampleId)) {
          if (fallbackCore) {
            navigateTo(
              {
                page: 'report',
                reportType: route.reportType,
                sampleId: fallbackCore,
              },
              true,
            );
          } else {
            navigateTo({ page: 'home' }, true);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load report catalog';
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
      if (route.page === 'home') {
        setIsScreenBusy(false);
      }
    }
  }, [navigateTo, route]);

  const loadReportData = useCallback(async (reportType: ReportType, sampleId: string): Promise<void> => {
    setIsLoading(true);
    setIsScreenBusy(true);
    setIsReportLayoutReady(false);
    setBusyLabel(`Preparing ${reportType.toUpperCase()} ${sampleId}...`);
    setErrorMessage(null);

    try {
      const data = await fetchReportByTypeAndSample(reportType, sampleId);
      await preloadReportAssets(data);
      setReport(data);
      setSelectedPredictionKey('all');
      setShowMarkerMask(false);
      setShowPredictionNumbers(false);
      setHasLoadedOnce(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load report data';
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [preloadReportAssets]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRoute(window.location.pathname));
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    if (route.page !== 'report') {
      return;
    }

    setReportLoadTimedOut(false);

    void loadReportData(route.reportType, route.sampleId);
  }, [loadReportData, route]);

  useEffect(() => {
    if (route.page !== 'report' || report || errorMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setReportLoadTimedOut(true);
      setIsScreenBusy(false);
      setBusyLabel('This is taking longer than expected...');
    }, 60000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [route.page, report, errorMessage]);

  useEffect(() => {
    if (!report) {
      return;
    }

    const onWheelCapture = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const frame = target.closest('.sync-frame');
      if (!(frame instanceof HTMLDivElement)) {
        return;
      }

      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.15 : 0.87;
      zoomAround(event.clientX, event.clientY, factor, frame);
    };

    window.addEventListener('wheel', onWheelCapture, { passive: false, capture: true });

    const handleResize = () => {
      syncPredictionFrameSize();
      resetView();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('wheel', onWheelCapture, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [report, resetView, syncPredictionFrameSize, zoomAround]);

  useEffect(() => {
    if (route.page !== 'report' || !report) {
      return;
    }

    let disposed = false;
    let rafId = 0;
    let attempts = 0;

    const finalizeLayout = () => {
      if (disposed) {
        return;
      }

      syncPredictionFrameSize();
      resetView();

      const markerFrame = document.querySelector<HTMLDivElement>('.marker-tile .tile-frame');
      const predictionFrame = document.querySelector<HTMLDivElement>('.prediction-frame');
      const hasStableFrame =
        Boolean(markerFrame && markerFrame.clientWidth > 0) &&
        Boolean(predictionFrame && predictionFrame.clientWidth > 0);

      if (hasStableFrame || attempts >= 10) {
        setIsReportLayoutReady(true);
        setIsScreenBusy(false);
        return;
      }

      attempts += 1;
      rafId = window.requestAnimationFrame(finalizeLayout);
    };

    rafId = window.requestAnimationFrame(finalizeLayout);

    return () => {
      disposed = true;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [report, resetView, route.page, syncPredictionFrameSize]);

  const showLegend = selectedPredictionKey === 'all';
  const predictionImageSrc = selectedPrediction
    ? resolveRelativeImage(selectedPrediction.image)
    : report
      ? resolveRelativeImage(report.predictionAllImage)
      : '';

  const handleFrameRef = (index: number) => (element: HTMLDivElement | null) => {
    if (element) {
      frameRefs.current[index] = element;
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const dimensions = getImageDimensions();
    if (!dimensions) {
      return;
    }

    const fit = getBaseFit(event.currentTarget, dimensions);
    if (!fit) {
      return;
    }

    const state = viewStateRef.current;
    const scale = fit.scale * state.zoom;
    if (!scale) {
      return;
    }

    const dx = event.clientX - dragState.lastX;
    const dy = event.clientY - dragState.lastY;

    state.centerX -= dx / scale;
    state.centerY -= dy / scale;

    clampViewState(event.currentTarget);
    dragState.lastX = event.clientX;
    dragState.lastY = event.clientY;
    applyTransform();
  };

  const clearDragState = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (dragState && dragState.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }
  };

  const zoomFromButtons = (factor: number) => {
    const frame = frameRefs.current[0];
    if (!frame) {
      return;
    }

    const rect = frame.getBoundingClientRect();
    zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, factor, frame);
  };

  const handleRetry = () => {
    if (route.page === 'report') {
      setIsReportLayoutReady(false);
      setIsScreenBusy(true);
      void loadReportData(route.reportType, route.sampleId);
      return;
    }

    void loadCatalog();
  };

  const handleHomeTypeChange = (nextType: ReportType) => {
    setHomeReportType(nextType);
    const typeEntry = catalog?.reportTypes.find((entry) => entry.key === nextType);
    setHomeCoreId(typeEntry?.cores[0] || '');
  };

  const openFromHome = () => {
    if (!homeCoreId) {
      return;
    }

    navigateTo({
      page: 'report',
      reportType: homeReportType,
      sampleId: homeCoreId,
    });
  };

  const handleViewerTypeChange = (nextType: ReportType) => {
    const typeCatalog = catalog?.reportTypes.find((entry) => entry.key === nextType);
    if (!typeCatalog || typeCatalog.cores.length === 0) {
      return;
    }

    const nextCore = typeCatalog.cores.includes(route.page === 'report' ? route.sampleId : '')
      ? route.page === 'report'
        ? route.sampleId
        : typeCatalog.cores[0]
      : typeCatalog.cores[0];

    navigateTo({
      page: 'report',
      reportType: nextType,
      sampleId: nextCore,
    });
  };

  const handleViewerCoreChange = (nextCore: string) => {
    if (route.page !== 'report') {
      return;
    }

    navigateTo({
      page: 'report',
      reportType: route.reportType,
      sampleId: nextCore,
    });
  };

  if (errorMessage) {
    return (
      <div className="app-status">
        <h1>Report Error</h1>
        <p>{errorMessage}</p>
        <button type="button" className="retry-button" onClick={handleRetry}>
          Retry Request
        </button>
      </div>
    );
  }

  if (isLoading && !hasLoadedOnce && !catalog) {
    return (
      <div className="fullscreen-loader" aria-live="polite" aria-busy="true">
        <div className="loader-content">
          <span className="loader-spinner" />
          <p>{busyLabel}</p>
        </div>
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="app-status">
        <h1>No Report Catalog</h1>
        <p>No report catalog was returned by the API.</p>
      </div>
    );
  }

  if (route.page === 'home') {
    return (
      <>
        <div className="report-index-page">
          <div className="report-index-shell">
            <header className="report-index-header">
              <div className="report-index-kicker">T-NHL</div>
              <h1>Available Reports</h1>
              <p>
                Browse available resources across Argmax and Astir outputs, then open a selected
                report directly.
              </p>
            </header>

            <div className="index-meta-row">
              <span className="meta-chip">Total Reports: {catalog.totalReports}</span>
              {catalog.reportTypes.map((item) => (
                <span key={item.key} className="meta-chip">
                  {item.label}: {item.count}
                </span>
              ))}
            </div>

            <section className="home-launcher-card">
              <h2>Open Report</h2>
              <div className="home-launcher-controls">
                <div className="home-control">
                  <label htmlFor="home-report-type">Report Type</label>
                  <select
                    id="home-report-type"
                    value={homeReportType}
                    onChange={(event) => handleHomeTypeChange(event.target.value as ReportType)}
                  >
                    {catalog.reportTypes.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="home-control">
                  <label htmlFor="home-core-id">Core</label>
                  <select
                    id="home-core-id"
                    value={homeCoreId}
                    onChange={(event) => setHomeCoreId(event.target.value)}
                    disabled={!selectedTypeCatalog || selectedTypeCatalog.cores.length === 0}
                  >
                    {(selectedTypeCatalog?.cores || []).map((coreId) => (
                      <option key={coreId} value={coreId}>
                        {coreId}
                      </option>
                    ))}
                  </select>
                </div>

                <button type="button" onClick={openFromHome} disabled={!homeCoreId}>
                  Open Report
                </button>
              </div>
            </section>
          </div>
        </div>
        {isScreenBusy ? (
          <div className="fullscreen-loader" aria-live="polite" aria-busy="true">
            <div className="loader-content">
              <span className="loader-spinner" />
              <p>{busyLabel}</p>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (!report) {
    if (route.page === 'report' && !reportLoadTimedOut) {
      return (
        <div className="fullscreen-loader" aria-live="polite" aria-busy="true">
          <div className="loader-content">
            <span className="loader-spinner" />
            <p>{busyLabel}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="app-status">
        <h1>Report Not Available Yet</h1>
        <p>
          We are still preparing this report. Please try again in a moment.
        </p>
        <button type="button" className="retry-button" onClick={handleRetry}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="container uniform-sync-plots">
        <div className="title-row">
          <div className="viewer-nav-controls">
            <button
              type="button"
              className="home-icon-button"
              aria-label="Go to home"
              onClick={() => navigateTo({ page: 'home' })}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
                <path
                  d="M12 3L3 10.5h2V21h6v-6h2v6h6V10.5h2L12 3z"
                  fill="currentColor"
                />
              </svg>
            </button>

            <div className="title-selector">
              <label htmlFor="viewer-report-type">Type</label>
              <select
                id="viewer-report-type"
                value={route.reportType}
                onChange={(event) => handleViewerTypeChange(event.target.value as ReportType)}
              >
                {catalog.reportTypes.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="title-selector">
              <label htmlFor="report-sample-select">Core</label>
              <select
                id="report-sample-select"
                value={route.sampleId}
                onChange={(event) => handleViewerCoreChange(event.target.value)}
              >
                {(currentRouteCatalog?.cores || []).map((coreId) => (
                  <option key={coreId} value={coreId}>
                    {coreId}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <h1>{report.title}</h1>
        </div>

        <section className="card">
          <h2>Synchronized View with Processed Markers</h2>
          <div className="comparison-layout">
            <div className="prediction-stack">
              <section className="prediction-panel">
                <header>Cell Type Predictions</header>
                <div
                  className="prediction-frame sync-frame"
                  ref={handleFrameRef(0)}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={clearDragState}
                  onPointerCancel={clearDragState}
                >
                  <img
                    ref={predictionImageRef}
                    className="sync-image"
                    src={predictionImageSrc}
                    alt="Cell Type Predictions"
                    onLoad={() => {
                      syncPredictionFrameSize();
                      resetView();
                    }}
                  />
                  <img
                    className="sync-image prediction-number-overlay"
                    src={resolveRelativeImage(report.predictionNumbersOverlayImage)}
                    alt="Cell Type Numbers Overlay"
                    style={{ display: showPredictionNumbers ? 'block' : 'none' }}
                  />
                </div>
                <div className="panel-controls">
                  <button type="button" onClick={() => zoomFromButtons(1.25)}>
                    Zoom In
                  </button>
                  <button type="button" onClick={() => zoomFromButtons(0.8)}>
                    Zoom Out
                  </button>
                  <button type="button" onClick={resetView}>
                    Reset View
                  </button>
                </div>
              </section>

              <aside className="side-panel">
                <div className="control-row">
                  <section className="selector-card">
                    <h3>Cell Type Selector</h3>
                    <select
                      id="prediction-select"
                      value={selectedPredictionKey}
                      onChange={(event) => setSelectedPredictionKey(event.target.value)}
                    >
                      {report.predictionViews.map((view, index) => (
                        <option key={view.key} value={view.key}>
                          {index === 0 ? view.label : `${index}. ${view.label}`}
                        </option>
                      ))}
                    </select>

                    <label className="toggle-mask" htmlFor="marker-mask-toggle">
                      <input
                        id="marker-mask-toggle"
                        type="checkbox"
                        checked={showMarkerMask}
                        onChange={(event) => setShowMarkerMask(event.target.checked)}
                      />
                      Segmentation Mask
                    </label>
                    <br />
                    <label className="toggle-mask" htmlFor="prediction-number-toggle">
                      <input
                        id="prediction-number-toggle"
                        type="checkbox"
                        checked={showPredictionNumbers}
                        onChange={(event) => setShowPredictionNumbers(event.target.checked)}
                      />
                      Cell Type Numbers
                    </label>
                  </section>
                </div>

                <div
                  id="prediction-legend"
                  className="legend-box"
                  style={{ visibility: showLegend ? 'visible' : 'hidden' }}
                >
                  <img
                    src={resolveRelativeImage(report.predictionLegendImage)}
                    alt="Cell Type Legend"
                  />
                </div>
              </aside>
            </div>

            <section className="marker-column">
              <div className="marker-grid">
                {report.markerTiles.map((marker, index) => (
                  <section key={marker.key} className="marker-tile">
                    <header>{marker.label}</header>
                    <div
                      className="tile-frame sync-frame"
                      ref={handleFrameRef(index + 1)}
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={clearDragState}
                      onPointerCancel={clearDragState}
                    >
                      <img
                        className="sync-image marker-base-image"
                        src={resolveRelativeImage(marker.image)}
                        alt={`${marker.label} marker`}
                      />
                      <img
                        className="sync-image marker-segmentation-overlay"
                        src={resolveRelativeImage(marker.segmentationOverlay)}
                        alt="Segmentation Mask"
                        style={{ display: showMarkerMask ? 'block' : 'none' }}
                      />
                    </div>
                  </section>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="card">
          <h2>Raw Vs Processed</h2>
          <img
            className="img-static"
            src={resolveRelativeImage(report.rawProcessedImage)}
            alt="Raw vs Processed"
          />
        </section>
      </div>
      {isScreenBusy || !isReportLayoutReady ? (
        <div className="fullscreen-loader" aria-live="polite" aria-busy="true">
          <div className="loader-content">
            <span className="loader-spinner" />
            <p>{busyLabel}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default App;
