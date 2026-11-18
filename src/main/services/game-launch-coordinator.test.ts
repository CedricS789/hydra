import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameLaunchCoordinator } from "./game-launch-coordinator.ts";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function observation() {
  let running = false;
  const listeners = new Set<() => void>();
  return {
    isRunning: () => running,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      running = true;
      for (const listener of listeners) listener();
    },
    listeners,
  };
}

describe("game launch reservation", () => {
  it("coalesces rapid requests and keeps the reservation after dispatch until detection", async () => {
    const gate = new GameLaunchCoordinator();
    const state = observation();
    const dispatch = deferred<{ value: number; dispatched: boolean }>();
    let calls = 0;
    const launch = () => {
      calls++;
      return dispatch.promise;
    };
    const first = gate.run("steam:1", launch, state);
    assert.equal(gate.run("steam:1", launch, state), first);
    dispatch.resolve({ value: 42, dispatched: true });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(gate.run("steam:1", launch, state), first);
    assert.equal(calls, 1);
    state.start();
    assert.equal(await first, 42);
    assert.equal(state.listeners.size, 0);
  });
  it("does not wait for detection when a launch was blocked", async () => {
    const state = observation();
    assert.equal(
      await new GameLaunchCoordinator().run(
        "1",
        async () => ({ value: null, dispatched: false }),
        state
      ),
      null
    );
    assert.equal(state.listeners.size, 0);
  });
  it("releases failed requests and allows an explicit retry", async () => {
    const gate = new GameLaunchCoordinator();
    const state = observation();
    await assert.rejects(
      gate.run(
        "1",
        async () => {
          throw new Error("spawn failed");
        },
        state
      ),
      /spawn failed/
    );
    state.start();
    assert.equal(
      await gate.run("1", async () => ({ value: 7, dispatched: true }), state),
      7
    );
  });
  it("times out only after dispatch, unsubscribes and never retries automatically", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const gate = new GameLaunchCoordinator();
    const state = observation();
    let calls = 0;
    const request = gate.run(
      "1",
      async () => {
        calls++;
        return { value: 1, dispatched: true };
      },
      state
    );
    const rejection = assert.rejects(request, /game_launch_not_detected/);
    await Promise.resolve();
    await Promise.resolve();
    t.mock.timers.tick(60_000);
    await rejection;
    assert.equal(state.listeners.size, 0);
    assert.equal(calls, 1);
  });
  it("keeps other games independent and handles detection before subscription", async () => {
    const gate = new GameLaunchCoordinator();
    const state = observation();
    state.start();
    const pending = deferred<{ value: number; dispatched: boolean }>();
    const first = gate.run("1", () => pending.promise, state);
    assert.equal(
      await gate.run("2", async () => ({ value: 2, dispatched: true }), state),
      2
    );
    pending.resolve({ value: 1, dispatched: true });
    assert.equal(await first, 1);
  });
});
