import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Camera,
  ChevronLeft,
  ChevronRight,
  Eye,
  Layers,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  SlidersHorizontal,
  X,
  ZoomIn,
} from 'lucide-react';
import type { CameraPresetId, OrigamiModel } from './engine/origamiEngine';
import { CRANE_MODEL } from './models/crane';
import { PAPER_AIRPLANE_MODEL } from './models/paperAirplane';
import { OrigamiViewport } from './components/OrigamiViewport';

const MODELS: OrigamiModel[] = [CRANE_MODEL, PAPER_AIRPLANE_MODEL];

const CAMERA_OPTIONS: Array<{ id: CameraPresetId; label: string }> = [
  { id: 'iso', label: '立体' },
  { id: 'top', label: '俯视' },
  { id: 'front', label: '正面' },
  { id: 'side', label: '侧面' },
  { id: 'back', label: '背面' },
];

const PAPER_COLORS = [
  { name: '朱赤晕染和纸', hex: '#d4543b' },
  { name: '琉璃群青', hex: '#3b6291' },
  { name: '若竹抹茶', hex: '#558262' },
  { name: '山吹金茶', hex: '#c98a2c' },
  { name: '薄樱浅粉', hex: '#d98294' },
];

const MODEL_HERO_META: Record<
  string,
  { jpTitle: string; verticalTag: string; poeticLead: string; finaleTitle: string }
> = {
  'traditional-crane': {
    jpTitle: '折り鶴',
    verticalTag: '一紙の幾何・十五折',
    poeticLead:
      '一张素纸，十五道严格等距的折痕。随着页面向下展开，从二维平面生长为展翅欲飞的立体千纸鹤。',
    finaleTitle: '折り鶴完成 · 360° 自由赏玩',
  },
  'classic-dart': {
    jpTitle: '紙飛行機',
    verticalTag: '七折の軌跡・白紙',
    poeticLead:
      '以 A4 黄金比例纸张为起点，七道利落对称的折痕构筑出中央龙骨与翼梢小翼，零形变还原经典纸飞机。',
    finaleTitle: '紙飛行機完成 · 360° 自由赏玩',
  },
};

interface CreasePatternThumbProps {
  model: OrigamiModel;
  activeStepIndex: number;
  size?: number;
}

function CreasePatternThumb({ model, activeStepIndex, size = 56 }: CreasePatternThumbProps) {
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
    <svg
      className="cp-thumb"
      width={size}
      height={size}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      aria-label="2D 折痕展开图"
    >
      <rect
        x={-hw}
        y={-hl}
        width={model.paperWidth}
        height={model.paperLength}
        rx={0.04}
        fill="#fdfbf7"
        stroke="#b8afa0"
        strokeWidth={0.03}
      />
      {model.creases.map((c) => {
        const a = model.vertices2D[c.vA];
        const b = model.vertices2D[c.vB];
        const isActive = activeSet.has(c.id);
        const isPast = c.stepIndex < activeStepIndex;
        const stroke =
          c.foldType === 'valley'
            ? isActive
              ? '#2b6cb0'
              : '#4a7fa8'
            : isActive
              ? '#c85a32'
              : '#cf7451';
        return (
          <line
            key={c.id}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke={stroke}
            strokeWidth={isActive ? 0.055 : 0.02}
            strokeOpacity={isActive ? 1 : isPast ? 0.5 : 0.16}
            strokeDasharray={isActive ? '0.1 0.05' : undefined}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

export function App() {
  const [selectedModelId, setSelectedModelId] = useState<string>(CRANE_MODEL.id);
  const currentModel = useMemo(
    () => MODELS.find((m) => m.id === selectedModelId) ?? CRANE_MODEL,
    [selectedModelId],
  );
  const totalSteps = currentModel.steps.length;
  const heroMeta = MODEL_HERO_META[currentModel.id] ?? MODEL_HERO_META['traditional-crane'];

  // Exhibition scroll vs manual Atelier scrub
  const [isHero, setIsHero] = useState<boolean>(true);
  const [manualMode, setManualMode] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(totalSteps);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(1);

  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('iso');
  const [cameraTrigger, setCameraTrigger] = useState<number>(0);
  const [autoFollowView, setAutoFollowView] = useState<boolean>(true);
  const [xrayMode, setXrayMode] = useState<boolean>(false);
  const [showPip, setShowPip] = useState<boolean>(false);
  const [showCreases, setShowCreases] = useState<boolean>(true);
  const [enableZoom, setEnableZoom] = useState<boolean>(false);
  const [paperColor, setPaperColor] = useState<string>(PAPER_COLORS[0].hex);
  const [atelierOpen, setAtelierOpen] = useState<boolean>(false);

  const chaptersContainerRef = useRef<HTMLDivElement | null>(null);
  const ignoreScrollRef = useRef<boolean>(false);

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

  // Scroll-driven narrative synchronization
  useEffect(() => {
    const onScroll = () => {
      if (ignoreScrollRef.current) return;
      const vh = window.innerHeight || 800;
      const sy = window.scrollY;

      // Top Hero showcase zone: finished sculptural pose
      if (sy < vh * 0.45) {
        setIsHero(true);
        setManualMode(false);
        setIsPlaying(false);
        setProgress(totalSteps);
        return;
      }

      setIsHero(false);
      setManualMode(false);
      setIsPlaying(false);

      const chaptersEl = chaptersContainerRef.current;
      if (!chaptersEl) return;
      const startY = chaptersEl.offsetTop - vh * 0.15;
      const span = Math.max(1, chaptersEl.offsetHeight - vh * 0.4);
      const ratio = Math.max(0, Math.min(1, (sy - startY) / span));
      setProgress(ratio * totalSteps);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [totalSteps]);

  const scrollToStep = useCallback(
    (stepProg: number) => {
      const chaptersEl = chaptersContainerRef.current;
      const vh = window.innerHeight || 800;
      if (!chaptersEl) return;
      const startY = chaptersEl.offsetTop - vh * 0.15;
      const span = Math.max(1, chaptersEl.offsetHeight - vh * 0.4);
      const targetY = startY + (stepProg / totalSteps) * span;
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    },
    [totalSteps],
  );

  const scrollToHero = () => {
    setIsPlaying(false);
    setManualMode(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Continuous playback loop when user clicks Play
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

  // Auto camera preset switching on step change (only when not in Hero)
  useEffect(() => {
    if (!isHero && autoFollowView && currentStep) {
      setCameraPreset(currentStep.recommendedView);
      setCameraTrigger((c) => c + 1);
    }
  }, [activeStepIndex, autoFollowView, currentStep, isHero]);

  const handleTogglePlay = useCallback(() => {
    setManualMode(true);
    setIsHero(false);
    setProgress((prev) => (prev >= totalSteps - 0.001 || isHero ? 0 : prev));
    setIsPlaying((p) => !p);
  }, [isHero, totalSteps]);

  const handlePrevStep = useCallback(() => {
    setManualMode(true);
    setIsHero(false);
    setIsPlaying(false);
    setProgress((prev) => {
      const idx = prev >= totalSteps ? totalSteps - 1 : Math.floor(prev);
      const local = prev >= totalSteps ? 1 : prev - idx;
      return local > 0.06 ? idx : Math.max(0, idx - 1);
    });
  }, [totalSteps]);

  const handleNextStep = useCallback(() => {
    setManualMode(true);
    setIsHero(false);
    setIsPlaying(false);
    setProgress((prev) => {
      const idx = prev >= totalSteps ? totalSteps - 1 : Math.floor(prev);
      return Math.min(totalSteps, idx + 1);
    });
  }, [totalSteps]);

  const handleModelSwitch = (id: string) => {
    const nextModel = MODELS.find((m) => m.id === id) ?? CRANE_MODEL;
    setIsPlaying(false);
    setManualMode(false);
    setIsHero(true);
    setSelectedModelId(id);
    setProgress(nextModel.steps.length);
    handleSelectCamera('iso');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!currentStep) return null;

  return (
    <div className="exhibition-root">
      {/* Full-Bleed Fixed 3D Gallery Stage */}
      <div className="stage-backdrop">
        <OrigamiViewport
          model={currentModel}
          progress={safeProgress}
          cameraPreset={cameraPreset}
          cameraTrigger={cameraTrigger}
          xrayMode={xrayMode}
          showPip={showPip}
          showCreases={!isHero && showCreases}
          paperColor={paperColor}
          autoRotate={isHero && !manualMode}
          enableZoom={enableZoom}
        />
      </div>

      {/* Minimal Floating Top Navigation */}
      <header className="nav-header">
        <div className="nav-left">
          <button
            type="button"
            className="seal-button"
            onClick={scrollToHero}
            title="回到首屏"
          >
            <span className="hanko-seal" aria-hidden="true">
              折り
            </span>
            <span className="brand-name">和紙折紙</span>
          </button>

          <nav className="model-nav" aria-label="折纸作品切换">
            {MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`model-link ${selectedModelId === m.id ? 'active' : ''}`}
                onClick={() => handleModelSwitch(m.id)}
              >
                {m.shortName}
              </button>
            ))}
          </nav>
        </div>

        <div className="nav-right">
          <div className="pigment-dots" title="切换和纸传统色">
            {PAPER_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                aria-label={c.name}
                title={c.name}
                className={`pigment-dot ${paperColor === c.hex ? 'active' : ''}`}
                style={{ backgroundColor: c.hex }}
                onClick={() => setPaperColor(c.hex)}
              />
            ))}
          </div>

          <button
            type="button"
            className={`atelier-trigger ${atelierOpen ? 'active' : ''}`}
            onClick={() => setAtelierOpen((v) => !v)}
          >
            <SlidersHorizontal size={14} />
            <span>工坊精调</span>
          </button>
        </div>
      </header>

      {/* Right-Edge Vertical Exhibition Chapter Rail */}
      <aside className="chapter-rail" aria-label="步骤章节导航">
        <button
          type="button"
          className={`rail-dot ${isHero ? 'active' : ''}`}
          onClick={scrollToHero}
          title="首屏成品展示"
        />
        {currentModel.steps.map((st, idx) => {
          const isActive = !isHero && activeStepIndex === idx;
          return (
            <button
              key={st.id}
              type="button"
              className={`rail-dot ${isActive ? 'active' : ''}`}
              onClick={() => {
                setManualMode(false);
                scrollToStep(idx + 0.5);
              }}
              title={`${idx + 1}. ${st.title}`}
            />
          );
        })}
      </aside>

      {/* Scroll-Driven Editorial Narrative */}
      <main className="narrative-flow">
        {/* Hero Screen */}
        <section className="hero-section">
          <div className="hero-editorial">
            <div className="hero-title-lockup">
              <span className="hero-vertical-tag">{heroMeta.verticalTag}</span>
              <h1 className="hero-kanji">{heroMeta.jpTitle}</h1>
            </div>

            <p className="hero-lead">{heroMeta.poeticLead}</p>

            <div className="hero-actions">
              <button
                type="button"
                className="hero-primary-btn"
                onClick={() => scrollToStep(0.15)}
              >
                <span>向下逐折展开</span>
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                className="hero-secondary-btn"
                onClick={() => {
                  setAtelierOpen(true);
                  handleTogglePlay();
                }}
              >
                <Play size={14} />
                <span>连续演示</span>
              </button>
            </div>

            <p className="hero-hint">画布可随时左键 360° 拖拽旋转赏玩</p>
          </div>
        </section>

        {/* Scroll Step Chapters */}
        <div ref={chaptersContainerRef} className="chapters-track">
          {currentModel.steps.map((step, idx) => {
            const isActive = !isHero && activeStepIndex === idx;
            const localPct =
              idx < activeStepIndex
                ? 100
                : idx > activeStepIndex
                  ? 0
                  : Math.round(stepLocalProgress * 100);

            return (
              <section
                key={step.id}
                className={`chapter-section ${isActive ? 'is-active' : ''}`}
              >
                <article className="chapter-note">
                  <div className="chapter-top">
                    <div>
                      <div className="chapter-index">
                        第 {String(idx + 1).padStart(2, '0')} 折 / {totalSteps}
                      </div>
                      <h2 className="chapter-title">{step.title}</h2>
                    </div>
                    <CreasePatternThumb model={currentModel} activeStepIndex={idx} size={56} />
                  </div>

                  <p className="chapter-desc">{step.instruction}</p>
                  <p className="chapter-tip">{step.tip}</p>

                  <div className="chapter-footer">
                    <span className="chapter-pct">折合度 {localPct}%</span>
                    <div className="chapter-links">
                      <button
                        type="button"
                        className="text-action"
                        onClick={() => {
                          setManualMode(true);
                          setIsHero(false);
                          setIsPlaying(false);
                          setProgress(idx + 0.5);
                          setAtelierOpen(true);
                        }}
                      >
                        慢放微调此步
                      </button>
                      <button
                        type="button"
                        className="text-action"
                        onClick={() => handleSelectCamera(step.recommendedView)}
                      >
                        最佳视角
                      </button>
                    </div>
                  </div>
                </article>
              </section>
            );
          })}
        </div>

        {/* Finale Exhibition Section */}
        <section className="finale-section">
          <div className="finale-card">
            <span className="finale-seal">完</span>
            <h2 className="finale-title">{heroMeta.finaleTitle}</h2>
            <p className="finale-desc">
              每一处棱角与面片均严守刚性等距物理约束。自由拖拽旋转模型，或切换另一件折纸作品继续探索。
            </p>
            <div className="hero-actions">
              <button type="button" className="hero-primary-btn" onClick={scrollToHero}>
                <span>回到首屏</span>
              </button>
              <button
                type="button"
                className="hero-secondary-btn"
                onClick={() =>
                  handleModelSwitch(
                    selectedModelId === CRANE_MODEL.id
                      ? PAPER_AIRPLANE_MODEL.id
                      : CRANE_MODEL.id,
                  )
                }
              >
                <span>
                  探索「
                  {selectedModelId === CRANE_MODEL.id
                    ? PAPER_AIRPLANE_MODEL.shortName
                    : CRANE_MODEL.shortName}
                  」
                </span>
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Lightweight Floating Bottom Capsule + Expandable Atelier Drawer */}
      <div className="floating-dock">
        {atelierOpen && (
          <div className="atelier-drawer">
            <div className="drawer-header">
              <span className="drawer-title">
                {isHero
                  ? '成品展示姿态'
                  : `第 ${activeStepIndex + 1} / ${totalSteps} 步 · ${currentStep.title}`}
              </span>
              <button
                type="button"
                className="drawer-close"
                onClick={() => setAtelierOpen(false)}
                aria-label="收起工坊面板"
              >
                <X size={15} />
              </button>
            </div>

            <div className="drawer-scrub">
              <div className="drawer-scrub-labels">
                <span>单步慢放拆解</span>
                <span>{Math.round(stepLocalProgress * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.005}
                value={stepLocalProgress}
                onChange={(e) => {
                  setManualMode(true);
                  setIsHero(false);
                  setIsPlaying(false);
                  setProgress(activeStepIndex + parseFloat(e.target.value));
                }}
              />
            </div>

            <div className="drawer-scrub">
              <div className="drawer-scrub-labels">
                <span>全流程总进度</span>
                <span>
                  {safeProgress.toFixed(2)} / {totalSteps}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={totalSteps}
                step={0.01}
                value={safeProgress}
                onChange={(e) => {
                  setManualMode(true);
                  setIsHero(false);
                  setIsPlaying(false);
                  setProgress(parseFloat(e.target.value));
                }}
              />
            </div>

            <div className="drawer-row">
              <div className="drawer-group">
                <Camera size={13} className="drawer-icon" />
                {CAMERA_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`mini-pill ${cameraPreset === opt.id ? 'active' : ''}`}
                    onClick={() => handleSelectCamera(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`mini-pill ${autoFollowView ? 'active' : ''}`}
                  onClick={() => setAutoFollowView((v) => !v)}
                >
                  自动运镜
                </button>
              </div>
            </div>

            <div className="drawer-row">
              <div className="drawer-group">
                <button
                  type="button"
                  className={`mini-pill ${showCreases ? 'active' : ''}`}
                  onClick={() => setShowCreases((v) => !v)}
                >
                  <Layers size={12} /> 折痕
                </button>
                <button
                  type="button"
                  className={`mini-pill ${xrayMode ? 'active' : ''}`}
                  onClick={() => setXrayMode((v) => !v)}
                >
                  <Eye size={12} /> 透视
                </button>
                <button
                  type="button"
                  className={`mini-pill ${showPip ? 'active' : ''}`}
                  onClick={() => setShowPip((v) => !v)}
                >
                  <PictureInPicture2 size={12} /> 背面窗
                </button>
                <button
                  type="button"
                  className={`mini-pill ${enableZoom ? 'active' : ''}`}
                  onClick={() => setEnableZoom((v) => !v)}
                  title="开启后可用鼠标滚轮缩放 3D 模型"
                >
                  <ZoomIn size={12} /> 滚轮缩放
                </button>
              </div>

              <div className="drawer-group">
                {[0.5, 1, 1.5, 2].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`mini-pill ${speed === s ? 'active' : ''}`}
                    onClick={() => setSpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="dock-pill">
          <button
            type="button"
            className="dock-icon-btn"
            onClick={() => {
              setManualMode(true);
              setIsHero(false);
              setIsPlaying(false);
              setProgress(0);
              handleSelectCamera('iso');
            }}
            title="重置回平纸"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="dock-icon-btn"
            onClick={handlePrevStep}
            title="上一步"
          >
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="dock-play-btn" onClick={handleTogglePlay}>
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            <span>{isPlaying ? '暂停' : '演示'}</span>
          </button>
          <button
            type="button"
            className="dock-icon-btn"
            onClick={handleNextStep}
            title="下一步"
          >
            <ChevronRight size={16} />
          </button>

          <span className="dock-divider" />

          <span className="dock-status">
            {isHero && !manualMode
              ? '成品赏玩'
              : `${String(activeStepIndex + 1).padStart(2, '0')} / ${totalSteps}`}
          </span>

          <button
            type="button"
            className={`dock-expand-btn ${atelierOpen ? 'active' : ''}`}
            onClick={() => setAtelierOpen((v) => !v)}
          >
            <SlidersHorizontal size={13} />
            <span>{atelierOpen ? '收起' : '精调'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
