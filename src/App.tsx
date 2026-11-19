import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Layers,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
} from 'lucide-react';
import type { CameraPresetId, OrigamiModel } from './engine/origamiEngine';
import { CRANE_MODEL } from './models/crane';
import { PAPER_AIRPLANE_MODEL } from './models/paperAirplane';
import { OrigamiViewport } from './components/OrigamiViewport';

const MODELS: OrigamiModel[] = [CRANE_MODEL, PAPER_AIRPLANE_MODEL];

const CAMERA_OPTIONS: Array<{ id: CameraPresetId; label: string }> = [
  { id: 'iso', label: '立体视角' },
  { id: 'top', label: '俯视' },
  { id: 'front', label: '正面' },
  { id: 'side', label: '侧面' },
  { id: 'back', label: '背面' },
];

const PAPER_COLORS = [
  { name: '朱红晕染和纸', hex: '#e0533c' },
  { name: '群青琉璃', hex: '#3b82f6' },
  { name: '千岁抹茶', hex: '#2f9e66' },
  { name: '山吹金黄', hex: '#d99b16' },
  { name: '樱花浅粉', hex: '#ec7393' },
];

interface CreasePatternMiniMapProps {
  model: OrigamiModel;
  activeStepIndex: number;
}

function CreasePatternMiniMap({ model, activeStepIndex }: CreasePatternMiniMapProps) {
  const hw = model.paperWidth / 2;
  const hl = model.paperLength / 2;
  const pad = 0.14;
  const vbX = -hw - pad;
  const vbY = -hl - pad;
  const vbW = model.paperWidth + pad * 2;
  const vbH = model.paperLength + pad * 2;

  const activeSet = useMemo(
    () => new Set(model.steps[activeStepIndex]?.activeCreaseIds ?? []),
    [model, activeStepIndex],
  );

  return (
    <div className="cp-card">
      <div className="cp-header">
        <span>2D 折痕展开图对照</span>
        <span className="cp-sub">实线已折 · 亮色当前步</span>
      </div>
      <svg className="cp-svg" viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}>
        <rect
          x={-hw}
          y={-hl}
          width={model.paperWidth}
          height={model.paperLength}
          rx={0.03}
          fill="#1e293b"
          stroke="#64748b"
          strokeWidth={0.025}
        />
        {model.creases.map((c) => {
          const a = model.vertices2D[c.vA];
          const b = model.vertices2D[c.vB];
          const isActive = activeSet.has(c.id);
          const isPast = c.stepIndex < activeStepIndex;
          const stroke =
            c.foldType === 'valley'
              ? isActive
                ? '#22d3ee'
                : '#38bdf8'
              : isActive
                ? '#fb923c'
                : '#f97316';
          return (
            <line
              key={c.id}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke={stroke}
              strokeWidth={isActive ? 0.042 : 0.018}
              strokeOpacity={isActive ? 1 : isPast ? 0.55 : 0.16}
              strokeDasharray={isActive ? '0.09 0.05' : undefined}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
    </div>
  );
}

export function App() {
  const [selectedModelId, setSelectedModelId] = useState<string>(CRANE_MODEL.id);
  const currentModel = useMemo(
    () => MODELS.find((m) => m.id === selectedModelId) ?? CRANE_MODEL,
    [selectedModelId],
  );
  const totalSteps = currentModel.steps.length;

  const [progress, setProgress] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(1);
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('iso');
  const [cameraTrigger, setCameraTrigger] = useState<number>(0);
  const [autoFollowView, setAutoFollowView] = useState<boolean>(false);
  const [xrayMode, setXrayMode] = useState<boolean>(false);
  const [showPip, setShowPip] = useState<boolean>(true);
  const [showCreases, setShowCreases] = useState<boolean>(true);
  const [paperColor, setPaperColor] = useState<string>(PAPER_COLORS[0].hex);
  const [liveStrainPct, setLiveStrainPct] = useState<number>(0);

  const safeProgress = Number.isFinite(progress)
    ? Math.max(0, Math.min(totalSteps, progress))
    : 0;
  const activeStepIndex =
    totalSteps === 0
      ? 0
      : safeProgress >= totalSteps
        ? totalSteps - 1
        : Math.floor(safeProgress);
  const stepLocalProgress =
    safeProgress >= totalSteps ? 1 : safeProgress - activeStepIndex;
  const currentStep = currentModel.steps[activeStepIndex];

  const handleSelectCamera = useCallback((preset: CameraPresetId) => {
    setCameraPreset(preset);
    setCameraTrigger((c) => c + 1);
  }, []);

  const handlePrevStep = useCallback(() => {
    setIsPlaying(false);
    setProgress((prev) => {
      const idx = prev >= totalSteps ? totalSteps - 1 : Math.floor(prev);
      const local = prev >= totalSteps ? 1 : prev - idx;
      return local > 0.06 ? idx : Math.max(0, idx - 1);
    });
  }, [totalSteps]);

  const handleNextStep = useCallback(() => {
    setIsPlaying(false);
    setProgress((prev) => {
      const idx = prev >= totalSteps ? totalSteps - 1 : Math.floor(prev);
      return Math.min(totalSteps, idx + 1);
    });
  }, [totalSteps]);

  const handleTogglePlay = useCallback(() => {
    setProgress((prev) => (prev >= totalSteps - 0.001 ? 0 : prev));
    setIsPlaying((p) => !p);
  }, [totalSteps]);

  const handleReset = () => {
    setIsPlaying(false);
    setProgress(0);
    handleSelectCamera('iso');
  };

  const handleJumpToStep = (stepIdx: number) => {
    setIsPlaying(false);
    setProgress(stepIdx);
  };

  // Continuous playback loop
  useEffect(() => {
    if (!isPlaying) return;
    let lastTime = performance.now();
    let frameId = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      setProgress((prev) => {
        const next = prev + dt * 0.48 * speed;
        if (next >= totalSteps) {
          setIsPlaying(false);
          return totalSteps;
        }
        return next;
      });
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, speed, totalSteps]);

  // Auto camera preset switching when enabled
  useEffect(() => {
    if (autoFollowView && currentStep) {
      setCameraPreset(currentStep.recommendedView);
      setCameraTrigger((c) => c + 1);
    }
  }, [activeStepIndex, autoFollowView, currentStep]);

  // Keyboard shortcuts: Space = Play/Pause, Left/Right = Step navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handlePrevStep();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleNextStep();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTogglePlay, handlePrevStep, handleNextStep]);

  if (!currentStep) return null;

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="top-bar">
        <div className="brand-group">
          <div className="brand-badge">折り</div>
          <div>
            <h1 className="brand-title">Origami 3D 刚性折纸演示台</h1>
            <p className="brand-subtitle">
              {currentModel.name} · 360° 自由拆解教学
            </p>
          </div>

          <div className="model-switcher">
            {MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`model-tab ${selectedModelId === m.id ? 'active' : ''}`}
                onClick={() => {
                  setIsPlaying(false);
                  setSelectedModelId(m.id);
                  setProgress(0);
                  handleSelectCamera('iso');
                }}
              >
                {m.shortName}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar-group">
          <div className="color-picker" title="切换和纸配色">
            {PAPER_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                aria-label={c.name}
                title={c.name}
                className={`color-dot ${paperColor === c.hex ? 'active' : ''}`}
                style={{ backgroundColor: c.hex }}
                onClick={() => setPaperColor(c.hex)}
              />
            ))}
          </div>

          <button
            type="button"
            className={`toggle-btn ${showCreases ? 'active' : ''}`}
            onClick={() => setShowCreases((v) => !v)}
          >
            <Layers size={15} />
            <span>折痕指示</span>
          </button>

          <button
            type="button"
            className={`toggle-btn ${xrayMode ? 'active' : ''}`}
            onClick={() => setXrayMode((v) => !v)}
          >
            <Eye size={15} />
            <span>X-Ray 透视</span>
          </button>

          <button
            type="button"
            className={`toggle-btn ${showPip ? 'active' : ''}`}
            onClick={() => setShowPip((v) => !v)}
          >
            <PictureInPicture2 size={15} />
            <span>背面小窗</span>
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <main className="workspace">
        {/* Left: 3D Multi-Angle Stage */}
        <section className="stage-panel">
          <OrigamiViewport
            model={currentModel}
            progress={safeProgress}
            cameraPreset={cameraPreset}
            cameraTrigger={cameraTrigger}
            xrayMode={xrayMode}
            showPip={showPip}
            showCreases={showCreases}
            paperColor={paperColor}
            onFrameEvaluated={setLiveStrainPct}
          />

          {/* Camera Bar */}
          <div className="camera-bar">
            <span className="camera-bar-label">
              <Camera size={14} /> 多角度机位
            </span>
            {CAMERA_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`cam-btn ${cameraPreset === opt.id ? 'active' : ''}`}
                onClick={() => handleSelectCamera(opt.id)}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              className={`cam-btn follow-btn ${autoFollowView ? 'active' : ''}`}
              onClick={() => setAutoFollowView((v) => !v)}
              title="随步骤切换自动平滑运镜至最佳观察角度"
            >
              自动运镜
            </button>
          </div>

          {/* Real-time Isometric Physics Telemetry Badge */}
          <div className="physics-badge" title="实时检测所有刚性三角面片边长相对初始平纸的拉伸误差">
            <CheckCircle2 size={13} className="physics-icon" />
            <span>刚性等距形变 {liveStrainPct < 0.0005 ? '0.000%' : `${liveStrainPct.toFixed(3)}%`}</span>
          </div>

          {/* Crease Legend */}
          <div className="crease-legend">
            <span className="legend-item">
              <i className="swatch valley" /> 谷折 (向内凹折)
            </span>
            <span className="legend-item">
              <i className="swatch mountain" /> 山折 (向外凸折)
            </span>
            <span className="legend-hint">左键 360° 旋转 · 右键平移 · 滚轮缩放 · 空格播放</span>
          </div>
        </section>

        {/* Right: Step Breakdown + 2D Crease Map */}
        <aside className="sidebar-panel">
          <div className="active-step-card">
            <div className="step-meta">
              <span className="step-pill">{currentStep.subtitle}</span>
              <span className="step-pct">
                {safeProgress >= totalSteps - 1e-4
                  ? '已完成 100%'
                  : `本步 ${Math.round(stepLocalProgress * 100)}%`}
              </span>
            </div>
            <h2 className="step-title">{currentStep.title}</h2>
            <p className="step-desc">{currentStep.instruction}</p>
            <div className="step-tip">
              <strong>观察要点：</strong>
              {currentStep.tip}
            </div>

            <div className="local-scrub">
              <div className="scrub-header">
                <span>单步慢放拆解滑块</span>
                <span>{Math.round(stepLocalProgress * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.005}
                value={stepLocalProgress}
                onChange={(e) => {
                  setIsPlaying(false);
                  setProgress(activeStepIndex + parseFloat(e.target.value));
                }}
              />
            </div>
          </div>

          <CreasePatternMiniMap model={currentModel} activeStepIndex={activeStepIndex} />

          <div className="steps-list">
            <div className="steps-list-header">
              <span>全流程步骤拆解 ({totalSteps} 步)</span>
              <button
                type="button"
                className="jump-end-btn"
                onClick={() => handleJumpToStep(totalSteps)}
              >
                直达成品
              </button>
            </div>
            {currentModel.steps.map((st, idx) => {
              const isDone = safeProgress >= idx + 1 - 1e-4;
              const isCurrent =
                idx === activeStepIndex &&
                (safeProgress < totalSteps || idx === totalSteps - 1);
              return (
                <button
                  key={st.id}
                  type="button"
                  className={`step-row ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}`}
                  onClick={() => handleJumpToStep(idx)}
                >
                  <span className="step-num">{idx + 1}</span>
                  <div className="step-row-text">
                    <div className="step-row-title">{st.title}</div>
                    <div className="step-row-sub">{st.subtitle}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      </main>

      {/* Bottom Master Timeline */}
      <footer className="timeline-bar">
        <div className="playback-controls">
          <button
            type="button"
            className="icon-btn"
            onClick={handleReset}
            title="重置回平整纸张"
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={handlePrevStep}
            title="上一步 (←)"
          >
            <ChevronLeft size={19} />
          </button>
          <button
            type="button"
            className="play-btn"
            onClick={handleTogglePlay}
          >
            {isPlaying ? <Pause size={17} /> : <Play size={17} />}
            <span>
              {isPlaying
                ? '暂停'
                : safeProgress >= totalSteps - 0.001
                  ? '从头重播'
                  : '连续演示'}
            </span>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={handleNextStep}
            title="下一步 (→)"
          >
            <ChevronRight size={19} />
          </button>
        </div>

        <div className="global-scrub">
          <div className="step-ticks">
            <button
              type="button"
              className={`tick-btn ${safeProgress < 0.25 ? 'active' : ''}`}
              onClick={() => handleJumpToStep(0)}
            >
              平纸
            </button>
            {currentModel.steps.map((st, idx) => (
              <button
                key={st.id}
                type="button"
                className={`tick-btn ${
                  Math.round(safeProgress) === idx + 1 ? 'active' : ''
                }`}
                onClick={() => handleJumpToStep(idx + 1)}
                title={`${idx + 1}. ${st.title}`}
              >
                {idx + 1}
              </button>
            ))}
          </div>
          <input
            type="range"
            className="global-slider"
            min={0}
            max={totalSteps}
            step={0.01}
            value={safeProgress}
            onChange={(e) => {
              setIsPlaying(false);
              setProgress(parseFloat(e.target.value));
            }}
          />
        </div>

        <div className="speed-group">
          {[0.5, 1, 1.5, 2].map((s) => (
            <button
              key={s}
              type="button"
              className={`speed-btn ${speed === s ? 'active' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}

export default App;
