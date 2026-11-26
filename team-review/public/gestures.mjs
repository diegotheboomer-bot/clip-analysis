// Source-image viewports keep labels independent of display size and zoom.
export function clampView(view, image) {
  const aspect = view[2] / view[3];
  const maximum = Math.min(image.width, image.height * aspect);
  const width = Math.max(Math.min(24, maximum), Math.min(maximum, view[2]));
  const height = width / aspect;
  return [
    Math.max(0, Math.min(image.width - width, view[0])),
    Math.max(0, Math.min(image.height - height, view[1])),
    width,
    height,
  ];
}

export function pointInView(point, view) {
  return [view[0] + point[0] * view[2], view[1] + point[1] * view[3]];
}

export function zoomView(view, anchor, position, factor, image) {
  const bounded = clampView([0, 0, view[2] / factor, view[3] / factor], image);
  return clampView(
    [
      anchor[0] - position[0] * bounded[2],
      anchor[1] - position[1] * bounded[3],
      bounded[2],
      bounded[3],
    ],
    image,
  );
}

// Native touch events handle phones and embedded mobile browsers. Pointer
// events handle mouse and pen. Both feed the same source-coordinate gesture.
export function bindImageGestures(canvas, options) {
  const points = new Map();
  const captured = new Set();
  const nativeTouch = "ontouchstart" in window;
  let mode = null,
    start = null,
    pinch = null;

  function relative(point) {
    const rect = canvas.getBoundingClientRect();
    return [
      (point.x - rect.left) / rect.width,
      (point.y - rect.top) / rect.height,
    ];
  }

  function pair() {
    const [a, b] = [...points.values()];
    return {
      midpoint: relative({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }

  function release(id) {
    captured.delete(id);
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }

  function clear() {
    const active = mode !== null;
    mode = start = pinch = null;
    points.clear();
    options.preview(null);
    for (const id of [...captured]) release(id);
    if (active) options.active(false);
  }

  function begin(id, point) {
    points.set(id, point);
    if (points.size === 1) {
      const view = [...options.getView()];
      mode = "draw";
      start = {
        client: point,
        point: pointInView(relative(point), view),
        view,
        moved: false,
      };
      options.active(true);
    } else if (points.size === 2 && mode !== "wait") {
      const { midpoint, distance } = pair();
      const view = [...options.getView()];
      pinch = { view, distance, anchor: pointInView(midpoint, view) };
      mode = "pinch";
      options.preview(null);
    }
  }

  function move() {
    if (mode === "pinch" && points.size >= 2) {
      const { midpoint, distance } = pair();
      options.setView(
        zoomView(
          pinch.view,
          pinch.anchor,
          midpoint,
          distance / pinch.distance,
          options.image(),
        ),
      );
    } else if (mode === "draw") {
      const point = points.values().next().value;
      start.moved ||=
        Math.hypot(point.x - start.client.x, point.y - start.client.y) >= 2;
      if (start.moved)
        options.preview([
          start.point,
          pointInView(relative(point), start.view),
        ]);
    }
  }

  function end(id) {
    if (!points.has(id)) return;
    const drawing = mode === "draw" ? start : null;
    const last = drawing
      ? pointInView(relative(points.get(id)), drawing.view)
      : null;
    points.delete(id);
    mode = points.size ? "wait" : null;
    start = pinch = null;
    options.preview(null);
    if (!points.size) options.active(false);
    if (drawing?.moved && options.enabled())
      options.commit(drawing.point, last);
  }

  if (nativeTouch) {
    canvas.addEventListener(
      "touchstart",
      (event) => {
        if (!options.enabled()) return;
        event.preventDefault();
        for (const touch of event.changedTouches) {
          begin("touch-" + touch.identifier, {
            x: touch.clientX,
            y: touch.clientY,
          });
        }
      },
      { passive: false },
    );
    canvas.addEventListener(
      "touchmove",
      (event) => {
        if (!points.size) return;
        event.preventDefault();
        for (const touch of event.touches) {
          const id = "touch-" + touch.identifier;
          if (points.has(id))
            points.set(id, { x: touch.clientX, y: touch.clientY });
        }
        move();
      },
      { passive: false },
    );
    canvas.addEventListener(
      "touchend",
      (event) => {
        if (!points.size) return;
        event.preventDefault();
        for (const touch of event.changedTouches) {
          const id = "touch-" + touch.identifier;
          if (points.has(id))
            points.set(id, { x: touch.clientX, y: touch.clientY });
        }
        move();
        for (const touch of event.changedTouches)
          end("touch-" + touch.identifier);
      },
      { passive: false },
    );
    canvas.addEventListener("touchcancel", clear);
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (
      (nativeTouch && event.pointerType === "touch") ||
      !options.enabled() ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    captured.add(event.pointerId);
    begin(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    move();
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    move();
    end(event.pointerId);
    release(event.pointerId);
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (points.has(event.pointerId)) clear();
  });
  canvas.addEventListener("lostpointercapture", (event) => {
    if (points.has(event.pointerId)) clear();
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey || !options.enabled() || mode) return;
      event.preventDefault();
      const position = relative({ x: event.clientX, y: event.clientY });
      const view = options.getView();
      options.setView(
        zoomView(
          view,
          pointInView(position, view),
          position,
          Math.exp(-event.deltaY * 0.01),
          options.image(),
        ),
      );
    },
    { passive: false },
  );
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  return clear;
}
