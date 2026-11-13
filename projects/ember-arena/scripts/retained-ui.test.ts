import assert from "node:assert/strict";
import { test } from "node:test";
import { mountUi, node, setUiStyle, text, unmountUi } from "../modules/ember-arena/api/ui.js";

test("stable HUD nodes are reused, direct style writes stay coherent, and removed properties reset defaults", () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const calls = { spawn: 0, text: 0, style: 0, clear: 0 };
  const mocks = {
    ui_spawn: () => { calls.spawn++; return true; },
    ui_set_style: () => { calls.style++; return true; },
    ui_set_text: () => { calls.text++; return true; },
    ui_clear: () => { calls.clear++; },
  };
  const previous = new Map(Object.keys(mocks).map((key) => [key, globals[key]]));
  Object.assign(globals, mocks);
  const view = (value: string, sized = true) => node("root", { width: sized ? 100 : undefined }, [text("label", value)]);
  try {
    mountUi(view("Turn 0"));
    const initial = { ...calls };
    mountUi(view("Turn 0"));
    assert.deepEqual(calls, initial);
    mountUi(view("Turn 1"));
    assert.equal(calls.spawn, initial.spawn);
    assert.equal(calls.clear, initial.clear);
    assert.equal(calls.text, initial.text + 1);
    setUiStyle("root", { width: 200 });
    const updated = calls.style;
    mountUi(view("Turn 1"));
    assert.equal(calls.style, updated + 1);
    mountUi(view("Turn 1", false));
    assert.equal(calls.clear, initial.clear + 1);
    assert.equal(calls.spawn, initial.spawn + 2);
  } finally {
    unmountUi();
    for (const [key, value] of previous) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
  }
});
