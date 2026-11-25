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

// One pointer draws a box. Two pointers zoom/pan and cancel the unfinished box.
// After a pinch, all fingers must lift before another drawing can begin.
export function bindImageGestures(canvas, options) {
  const pointers = new Map();
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
    const [a, b] = [...pointers.values()];
    return {
      midpoint: relative({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }

  function clear() {
    const ids = [...pointers.keys()];
    const wasActive = mode !== null;
    mode = start = pinch = null;
    pointers.clear();
    options.preview(null);
    for (const id of ids) {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    if (wasActive) options.active(false);
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (
      !options.enabled() ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      const view = [...options.getView()];
      mode = "draw";
      start = {
        client: [event.clientX, event.clientY],
        point: pointInView(relative(pointers.get(event.pointerId)), view),
        view,
        moved: false,
      };
      options.active(true);
    } else if (pointers.size === 2 && mode !== "wait") {
      const { midpoint, distance } = pair();
      const view = [...options.getView()];
      pinch = { view, distance, anchor: pointInView(midpoint, view) };
      mode = "pinch";
      options.preview(null);
    }
  });

  function move(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (mode === "pinch" && pointers.size >= 2) {
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
      start.moved ||=
        Math.hypot(
          event.clientX - start.client[0],
          event.clientY - start.client[1],
        ) >= 3;
      if (start.moved) {
        options.preview([
          start.point,
          pointInView(relative(pointers.get(event.pointerId)), start.view),
        ]);
      }
    }
  }
  canvas.addEventListener("pointermove", move);

  canvas.addEventListener("pointerup", (event) => {
    if (!pointers.has(event.pointerId)) return;
    move(event);
    const drawing = mode === "draw" ? start : null;
    const end = drawing
      ? pointInView(relative(pointers.get(event.pointerId)), drawing.view)
      : null;
    pointers.delete(event.pointerId);
    mode = pointers.size ? "wait" : null;
    start = pinch = null;
    options.preview(null);
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if (!pointers.size) options.active(false);
    if (drawing && options.enabled()) {
      if (drawing.moved) options.commit(drawing.point, end);
      else options.tap(...end);
    }
  });

  canvas.addEventListener("pointercancel", clear);
  canvas.addEventListener("lostpointercapture", (event) => {
    if (pointers.has(event.pointerId)) clear();
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
