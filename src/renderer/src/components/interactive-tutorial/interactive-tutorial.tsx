import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CheckCircleIcon,
  PlayIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button, Modal } from "@renderer/components";
import { setSidebarHidden } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import {
  TUTORIAL_STORAGE_KEY,
  TUTORIAL_TOURS,
  type TutorialTour,
} from "./tutorial-tours";
import "./interactive-tutorial.scss";

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const POPOVER_WIDTH = 380;
const POPOVER_MARGIN = 14;
const SPOTLIGHT_PADDING = 6;

const readCompletedTours = (): string[] => {
  try {
    const raw = localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const writeCompletedTours = (ids: string[]) => {
  try {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* Ignore storage quota errors. */
  }
};

export function InteractiveTutorial() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeTour, setActiveTour] = useState<TutorialTour | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [completedIds, setCompletedIds] =
    useState<string[]>(readCompletedTours);
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  const currentStep = activeTour ? activeTour.steps[stepIndex] : null;

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const custom = event as CustomEvent<{ tourId?: string } | undefined>;
      const requestedId = custom.detail?.tourId;
      if (requestedId) {
        const found = TUTORIAL_TOURS.find((tour) => tour.id === requestedId);
        if (found) {
          setPickerOpen(false);
          setActiveTour(found);
          setStepIndex(0);
          return;
        }
      }
      setActiveTour(null);
      setPickerOpen(true);
    };

    window.addEventListener("hydra:open-interactive-tutorial", handleOpen);
    return () => {
      window.removeEventListener("hydra:open-interactive-tutorial", handleOpen);
    };
  }, []);

  const markCompleted = useCallback((tourId: string) => {
    setCompletedIds((current) => {
      if (current.includes(tourId)) return current;
      const next = [...current, tourId];
      writeCompletedTours(next);
      return next;
    });
  }, []);

  const startTour = (tour: TutorialTour) => {
    setPickerOpen(false);
    setActiveTour(tour);
    setStepIndex(0);
  };

  const exitTour = useCallback((reopenPicker = false) => {
    setActiveTour(null);
    setStepIndex(0);
    setRect(null);
    if (reopenPicker) setPickerOpen(true);
  }, []);

  const goNext = useCallback(() => {
    if (!activeTour) return;
    if (stepIndex >= activeTour.steps.length - 1) {
      markCompleted(activeTour.id);
      exitTour(true);
      return;
    }
    setStepIndex((value) => value + 1);
  }, [activeTour, stepIndex, markCompleted, exitTour]);

  const goBack = useCallback(() => {
    setStepIndex((value) => Math.max(0, value - 1));
  }, []);

  // Navigate automatically whenever a step specifies a route.
  useEffect(() => {
    if (currentStep?.selector?.startsWith(".sidebar")) {
      dispatch(setSidebarHidden(false));
    }
    if (!currentStep?.route) return;
    const currentFull = `${location.pathname}${location.search}`;
    if (currentFull !== currentStep.route) {
      navigate(currentStep.route);
    }
  }, [currentStep, dispatch, location.pathname, location.search, navigate]);

  // Measure target element rectangle and keep it synced across resizes/scrolls/renders.
  useLayoutEffect(() => {
    if (!currentStep) {
      setRect(null);
      return;
    }

    const measure = () => {
      if (!currentStep.selector) {
        setRect(null);
        return;
      }
      const element = document.querySelector(currentStep.selector);
      if (!element) {
        setRect(null);
        return;
      }
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) {
        setRect(null);
        return;
      }
      setRect({
        top: Math.max(0, box.top - SPOTLIGHT_PADDING),
        left: Math.max(0, box.left - SPOTLIGHT_PADDING),
        width: box.width + SPOTLIGHT_PADDING * 2,
        height: box.height + SPOTLIGHT_PADDING * 2,
      });
    };

    const scrollAndMeasure = () => {
      if (currentStep.selector) {
        const element = document.querySelector(currentStep.selector);
        element?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      measure();
    };

    const timer = window.setTimeout(scrollAndMeasure, 120);
    const retryTimer = window.setTimeout(measure, 360);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer.disconnect();
    };
  }, [currentStep]);

  useEffect(() => {
    if (!activeTour) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        exitTour(false);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      } else if (event.key === "ArrowLeft" && stepIndex > 0) {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTour, stepIndex, exitTour, goNext, goBack]);

  const popoverStyle = (() => {
    if (!rect) return undefined;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estimatedHeight = 250;

    // Prefer right of spotlight if wide enough (e.g. sidebars), else below, above, or clamped.
    if (rect.left + rect.width + POPOVER_MARGIN + POPOVER_WIDTH <= vw) {
      return {
        top: Math.max(
          POPOVER_MARGIN,
          Math.min(rect.top, vh - estimatedHeight - POPOVER_MARGIN)
        ),
        left: rect.left + rect.width + POPOVER_MARGIN,
      };
    }
    if (rect.top + rect.height + POPOVER_MARGIN + estimatedHeight <= vh) {
      return {
        top: rect.top + rect.height + POPOVER_MARGIN,
        left: Math.max(
          POPOVER_MARGIN,
          Math.min(rect.left, vw - POPOVER_WIDTH - POPOVER_MARGIN)
        ),
      };
    }
    if (rect.top - POPOVER_MARGIN - estimatedHeight >= 0) {
      return {
        top: rect.top - POPOVER_MARGIN - estimatedHeight,
        left: Math.max(
          POPOVER_MARGIN,
          Math.min(rect.left, vw - POPOVER_WIDTH - POPOVER_MARGIN)
        ),
      };
    }
    return {
      bottom: POPOVER_MARGIN,
      right: POPOVER_MARGIN,
    };
  })();

  return (
    <>
      <Modal
        visible={pickerOpen}
        title="Interactive Tutorials"
        description="Guided live walkthroughs across Hydra Ludusavi's features"
        onClose={() => setPickerOpen(false)}
        className="interactive-tutorial__picker-modal"
      >
        <div className="interactive-tutorial__picker">
          <div className="interactive-tutorial__tours">
            {TUTORIAL_TOURS.map((tour) => {
              const done = completedIds.includes(tour.id);
              return (
                <div
                  key={tour.id}
                  className={`interactive-tutorial__tour-card ${done ? "is-done" : ""}`}
                >
                  <div className="interactive-tutorial__tour-body">
                    <div className="interactive-tutorial__tour-top">
                      <strong>{tour.title}</strong>
                      <span className="interactive-tutorial__step-count">
                        {tour.steps.length} steps
                      </span>
                      {done && (
                        <span className="interactive-tutorial__done-pill">
                          <CheckCircleIcon size={12} aria-hidden="true" />
                          Completed
                        </span>
                      )}
                    </div>
                    <p>{tour.summary}</p>
                  </div>
                  <Button
                    theme={done ? "outline" : "primary"}
                    onClick={() => startTour(tour)}
                  >
                    <PlayIcon size={14} />
                    {done ? "Replay" : "Start"}
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="interactive-tutorial__picker-footer">
            <Button
              theme="outline"
              disabled={completedIds.length === 0}
              onClick={() => {
                setCompletedIds([]);
                writeCompletedTours([]);
              }}
            >
              <SyncIcon size={14} />
              Reset progress
            </Button>
            <Button theme="outline" onClick={() => setPickerOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {activeTour && currentStep && (
        <div
          className="interactive-tutorial__overlay"
          role="dialog"
          aria-modal="false"
          aria-label={`${activeTour.title} — Step ${stepIndex + 1} of ${activeTour.steps.length}`}
        >
          {rect ? (
            <div
              className="interactive-tutorial__spotlight"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
              }}
            />
          ) : (
            <div className="interactive-tutorial__backdrop" />
          )}

          <div
            className={`interactive-tutorial__popover ${!rect ? "is-centered" : ""}`}
            style={popoverStyle}
          >
            <div className="interactive-tutorial__popover-top">
              <span className="interactive-tutorial__tour-badge">
                {activeTour.title} · {stepIndex + 1}/{activeTour.steps.length}
              </span>
              <button
                type="button"
                className="interactive-tutorial__close"
                aria-label="Exit tutorial"
                onClick={() => exitTour(false)}
              >
                <XIcon size={14} />
              </button>
            </div>

            <div className="interactive-tutorial__progress">
              {activeTour.steps.map((step, index) => (
                <span
                  key={step.id}
                  className={index <= stepIndex ? "is-active" : ""}
                />
              ))}
            </div>

            <h3>{currentStep.title}</h3>
            <p>{currentStep.description}</p>
            {currentStep.hint && (
              <p className="interactive-tutorial__hint">{currentStep.hint}</p>
            )}

            <div className="interactive-tutorial__popover-actions">
              <Button theme="outline" onClick={() => exitTour(true)}>
                All tours
              </Button>
              <div>
                {stepIndex > 0 && (
                  <Button theme="outline" onClick={goBack}>
                    Back
                  </Button>
                )}
                <Button theme="primary" onClick={goNext}>
                  {stepIndex === activeTour.steps.length - 1
                    ? "Finish tour"
                    : "Next"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
