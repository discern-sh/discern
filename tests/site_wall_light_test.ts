/** The pointer light's interpolation and reduced-motion decisions are pure functions. */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
  wallKnobDefaults,
  type WallKnobName,
} from "../site/wall/tuning/knobs.ts";
import {
  type Light,
  lightFrame,
  lightGap,
  type LightPace,
  lightPace,
  type LightPoint,
  lightStep,
} from "../site/wall/use_light.ts";

/** Read the configured default for one light knob. */
function shipped(name: WallKnobName): number {
  return wallKnobDefaults()[name];
}

/** How the light keeps pace as shipped, for a visitor who has asked nothing. */
const PACE: LightPace = lightPace(shipped, false);

/** One frame at sixty to the second, in milliseconds. */
const FRAME = 16;

Deno.test("the light closes on its target without overshoot and arrives exactly", () => {
  const from: LightPoint = { x: -400, y: 900 };
  const to: LightPoint = { x: 640, y: 120 };
  assertStrictEquals(lightStep(from, to, FRAME, 0), to, "no ease, no glide");
  assertEquals(lightStep(from, to, 0, PACE.ease), from, "no time, no travel");
  assertEquals(
    lightStep(from, to, -5, PACE.ease),
    from,
    "time never runs backward",
  );

  let at = from;
  let frames = 0;
  while (at !== to) {
    const next = lightStep(at, to, FRAME, PACE.ease);
    const before = Math.hypot(to.x - at.x, to.y - at.y);
    const after = Math.hypot(to.x - next.x, to.y - next.y);
    assert(after < before, "every frame is nearer the target");
    assert(
      Math.sign(to.x - next.x) !== -Math.sign(to.x - at.x) &&
        Math.sign(to.y - next.y) !== -Math.sign(to.y - at.y),
      "the light never passes its target",
    );
    at = next;
    frames += 1;
    assert(frames < 120, "the light arrives, so a still pointer costs nothing");
  }

  // The same distance takes the same time whatever the frame rate.
  const oneLongFrame = lightStep(from, to, 3 * FRAME, PACE.ease);
  let threeShort = from;
  for (let frame = 0; frame < 3; frame++) {
    threeShort = lightStep(threeShort, to, FRAME, PACE.ease);
  }
  assert(Math.abs(oneLongFrame.x - threeShort.x) < 1e-6);
  assert(Math.abs(oneLongFrame.y - threeShort.y) < 1e-6);
});

Deno.test("the light comes up where the pointer is and goes down where it stands", () => {
  const pointer = { x: 600, y: 400 };
  let light: Light = { at: { x: -40, y: 90 }, on: 0 };

  light = lightFrame(light, pointer, FRAME, PACE);
  assertStrictEquals(light.at, pointer, "a dark light comes up at the pointer");
  assert(light.on > 0 && light.on < 1, "it comes up over several frames");
  let frames = 1;
  while (light.on < 1) {
    const next = lightFrame(light, pointer, FRAME, PACE);
    assertStrictEquals(next.at, pointer, "it does not travel as it comes up");
    assert(next.on > light.on, "it only brightens");
    light = next;
    assert(++frames < 60, "it finishes coming up");
  }
  assertEquals(light.on, 1, "it stops exactly at full");
  assert(frames >= PACE.fade / FRAME, "it takes the whole fade to come up");
  assertEquals(
    lightFrame(light, pointer, FRAME, PACE),
    light,
    "a light at rest on a still pointer has nothing left to write",
  );

  const stood = light.at;
  while (light.on > 0) {
    const next = lightFrame(light, null, FRAME, PACE);
    assertStrictEquals(next.at, stood, "it goes down where it stands");
    assert(next.on < light.on, "it only dims");
    light = next;
  }
  assertEquals(light.on, 0, "it stops exactly at dark");
});

Deno.test("the light follows the pointer only as far as its own size", () => {
  const home = { x: 100, y: 100 };
  const reachable = { x: home.x + PACE.span, y: home.y };
  const followed = lightFrame({ at: home, on: 1 }, reachable, FRAME, PACE);
  assert(
    followed.at.x > home.x && followed.at.x < reachable.x,
    "a pointer within its size draws the light toward it",
  );
  assertEquals(followed.on, 1, "and the light stays up on the way");

  // A pointer suddenly farther off than that is not followed. The light goes
  // down at home and comes up at the pointer, and is never seen in between.
  const far = { x: reachable.x + 1, y: home.y };
  let light: Light = { at: home, on: 1 };
  const places = new Set<number>();
  let wentDark = false;
  for (let frames = 0; frames < 120 && light.at !== far; frames++) {
    light = lightFrame(light, far, FRAME, PACE);
    if (light.on > 0) places.add(light.at.x);
    wentDark ||= light.on === 0;
  }
  assertStrictEquals(light.at, far, "the light reaches a far pointer");
  assert(wentDark, "it goes dark before it changes place");
  assertEquals([...places], [home.x, far.x], "it is seen in two places only");

  // A pointer that comes back within its size while it dims is followed
  // again, and the light comes back up from where it had got to.
  const dimming = lightFrame({ at: home, on: 1 }, far, FRAME, PACE);
  const back = lightFrame(dimming, reachable, FRAME, PACE);
  assert(back.on > dimming.on && back.at.x > home.x);
});

Deno.test("a card is as far from the light as its nearest edge", () => {
  const box = { left: 100, top: 50, right: 300, bottom: 150 };
  assertEquals(lightGap({ x: 200, y: 100 }, box), 0, "inside it");
  assertEquals(lightGap({ x: 100, y: 150 }, box), 0, "on its corner");
  assertEquals(lightGap({ x: 60, y: 100 }, box), 40, "off its left edge");
  assertEquals(lightGap({ x: 200, y: 170 }, box), 20, "below it");
  assertEquals(lightGap({ x: 303, y: 46 }, box), 5, "off a corner");
});
