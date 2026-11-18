import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { GamepadService as GamepadServiceType } from "./gamepad.service.js";
import { GamepadButtonType } from "../types/gamepad.types.js";

const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const previousDescriptors = new Map<string, PropertyDescriptor | undefined>();

function setGlobal(key: string, value: unknown) {
  if (!previousDescriptors.has(key)) {
    previousDescriptors.set(
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)
    );
  }
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}

function restoreGlobals() {
  for (const [key, descriptor] of previousDescriptors) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[key];
    }
  }
  previousDescriptors.clear();
}

interface MockGamepad {
  axes: number[];
  buttons: Array<{ pressed: boolean; touched: boolean; value: number }>;
  connected: boolean;
  id: string;
  index: number;
  mapping: string;
  timestamp: number;
}

function createMockGamepad(pressedButtons: number[] = []): MockGamepad {
  const buttons = Array.from({ length: 17 }, (_, idx) => ({
    pressed: pressedButtons.includes(idx),
    touched: pressedButtons.includes(idx),
    value: pressedButtons.includes(idx) ? 1 : 0,
  }));

  return {
    axes: [0, 0, 0, 0],
    buttons,
    connected: true,
    id: "Xbox Controller (STANDARD GAMEPAD Vendor: 045e Product: 02ea)",
    index: 0,
    mapping: "standard",
    timestamp: Date.now(),
  };
}

describe("GamepadService polling lifecycle", () => {
  let tempDir: string;
  let GamepadServiceClass: typeof GamepadServiceType;
  let listeners: Map<string, Set<(event: unknown) => void>>;
  let rafQueue: Map<number, (time: number) => void>;
  let cancelledIds: number[];
  let nextRafId: number;
  let activeGamepad: MockGamepad | null;
  let service: GamepadServiceType;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hydra-gamepad-service-"));
    const outfile = join(tempDir, "gamepad.service.mjs");
    await build({
      entryPoints: [
        fileURLToPath(new URL("./gamepad.service.ts", import.meta.url)),
      ],
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["electron"],
      outfile,
      tsconfig: join(projectRoot, "tsconfig.web.json"),
    });
    const mod = await import(pathToFileURL(outfile).href);
    GamepadServiceClass = mod.GamepadService;
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    listeners = new Map();
    rafQueue = new Map();
    cancelledIds = [];
    nextRafId = 1;
    activeGamepad = null;

    const mockWindow = {
      addEventListener(type: string, listener: (event: unknown) => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        listeners.get(type)?.delete(listener);
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };

    setGlobal("window", mockWindow);
    setGlobal("navigator", {
      getGamepads: () => (activeGamepad ? [activeGamepad] : []),
    });
    setGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
      const id = nextRafId++;
      rafQueue.set(id, callback);
      return id;
    });
    setGlobal("cancelAnimationFrame", (id: number) => {
      cancelledIds.push(id);
      rafQueue.delete(id);
    });

    service = new GamepadServiceClass();
  });

  afterEach(() => {
    service.dispose();
    restoreGlobals();
  });

  function emitGamepadConnected(gamepad: MockGamepad) {
    activeGamepad = gamepad;
    for (const listener of listeners.get("gamepadconnected") ?? []) {
      listener({ gamepad });
    }
  }

  it("stops requestAnimationFrame polling when input is disabled and resumes on re-enable", () => {
    emitGamepadConnected(createMockGamepad());

    assert.equal(rafQueue.size, 1);
    const scheduledId = [...rafQueue.keys()][0];

    service.setInputEnabled(false);

    assert.equal(rafQueue.size, 0);
    assert.deepEqual(cancelledIds, [scheduledId]);

    service.setInputEnabled(true);

    assert.equal(rafQueue.size, 1);
  });

  it("does not start polling on gamepad connect while input is disabled", () => {
    service.setInputEnabled(false);
    emitGamepadConnected(createMockGamepad());

    assert.equal(rafQueue.size, 0);

    service.setInputEnabled(true);

    assert.equal(rafQueue.size, 1);
  });

  it("syncs held buttons silently on resume without emitting stale press callbacks", () => {
    emitGamepadConnected(createMockGamepad());

    const pressedEvents: GamepadButtonType[] = [];
    service.onButtonPress(GamepadButtonType.BUTTON_A, (event) => {
      pressedEvents.push(event.button);
    });

    service.setInputEnabled(false);
    // User holds A while another window (game) is focused.
    activeGamepad = createMockGamepad([0]);

    service.setInputEnabled(true);

    assert.deepEqual(pressedEvents, []);

    // Run one animation frame while A remains held -> still no spurious press.
    const nextFrame = [...rafQueue.values()][0];
    rafQueue.clear();
    nextFrame(performance.now());
    assert.deepEqual(pressedEvents, []);

    // Release and press A after focus is restored -> press callback fires normally.
    activeGamepad = createMockGamepad([]);
    const releaseFrame = [...rafQueue.values()][0];
    rafQueue.clear();
    releaseFrame(performance.now());

    activeGamepad = createMockGamepad([0]);
    const pressFrame = [...rafQueue.values()][0];
    rafQueue.clear();
    pressFrame(performance.now());

    assert.deepEqual(pressedEvents, [GamepadButtonType.BUTTON_A]);
  });
});
