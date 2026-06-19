(function () {
  "use strict";

  const CONFIG = window.TRAINER_CONFIG || {};
  const TABLE = CONFIG.table || "training_pages";
  const BUCKET = CONFIG.bucket || "training-images";
  const MIN_SIZE = 1.2;

  // Supabase client (loaded via CDN as window.supabase). Shared MyMedInfo project.
  const SB = (window.supabase && CONFIG.supabaseUrl)
    ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      })
    : null;

  const state = {
    projectId: newId(),
    title: "Reception Visualisation Training",
    image: "",
    imagePath: "",
    imageName: "",
    imageWidth: 0,
    imageHeight: 0,
    published: false,
    hotspots: [],
    selectedId: "",
    mode: "draw",
    zoom: "fit",
    scale: 1,
    isSpaceDown: false,
    action: null,
    saveTimer: 0,
    dirty: false,
    isEditor: false,
    viewMode: "user",
    publicPageId: "",
    hasLock: false,
    lockRefreshTimer: 0
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    [
      "projectTitle", "publishToggle", "newProjectBtn", "saveNowBtn", "projectList",
      "deleteProjectBtn", "saveStatus", "imageInput", "imageInputBtn",
      "hotspotListPanel", "drawBtn", "selectBtn", "panBtn", "fitBtn", "fitWidthBtn", "actualBtn", "modeText", "zoomText",
      "stageWrap", "stage", "selectedSelect", "hotTitle", "hotLabel", "hotGuidance", "hotMeta", "hotColor", "hotX",
      "hotY", "hotW", "hotH", "deleteBtn", "duplicateBtn", "metaToggleBtn", "metaSection",
      "topbarMeta", "userModeBtn", "editorModeBtn", "signOutBtn", "userShell",
      "editorShell", "userRail", "publicPageList", "publicFrame", "canvasTip", "editorModal",
      "editorEmail", "editorPassword", "editorSubmitBtn", "editorCancelBtn", "editorModalText",
      "listTabBtn", "editorTabBtn", "listView", "editorView"
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });

    wireEvents();
    setMode("draw");
    render();
    setStatus(SB ? "Ready" : "Backend not configured");
    applyViewMode();
    renderPublicCatalog();

    // Release lock when user leaves
    window.addEventListener("beforeunload", async () => {
      if (state.hasLock) {
        await releaseLock(state.projectId);
      }
    });
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function wireEvents() {
    els.projectTitle.addEventListener("input", () => {
      state.title = els.projectTitle.value.trim() || "Untitled training guide";
      markDirty();
    });
    els.publishToggle.addEventListener("change", () => {
      state.published = els.publishToggle.checked;
      markDirty();
    });
    els.newProjectBtn.addEventListener("click", newProject);
    els.saveNowBtn.addEventListener("click", () => saveProject(true));
    els.projectList.addEventListener("change", loadSelectedProject);
    els.deleteProjectBtn.addEventListener("click", deleteSelectedProject);
    els.imageInput.addEventListener("change", handleImageUpload);

    els.drawBtn.addEventListener("click", () => setMode("draw"));
    els.selectBtn.addEventListener("click", () => setMode("select"));
    els.panBtn.addEventListener("click", () => setMode("pan"));
    els.fitBtn.addEventListener("click", () => {
      state.zoom = "fit";
      applyZoom();
    });
    els.fitWidthBtn.addEventListener("click", () => {
      state.zoom = "fit-width";
      applyZoom();
    });
    els.actualBtn.addEventListener("click", () => {
      state.zoom = "actual";
      applyZoom();
    });

    els.imageInputBtn.addEventListener("click", () => els.imageInput.click());
    els.stageWrap.addEventListener("pointerdown", onStagePointerDown);
    els.stageWrap.addEventListener("pointermove", onStagePointerMove);
    els.stageWrap.addEventListener("pointerup", endPointerAction);
    els.stageWrap.addEventListener("pointercancel", endPointerAction);
    els.stageWrap.addEventListener("scroll", () => positionStageForFit(false));
    window.addEventListener("resize", () => applyZoom());

    document.addEventListener("keydown", (event) => {
      if (event.code === "Space" && !isTyping(event.target)) {
        event.preventDefault();
        state.isSpaceDown = true;
        els.stageWrap.classList.add("is-panning");
      }
    });
    document.addEventListener("keyup", (event) => {
      if (event.code === "Space") {
        state.isSpaceDown = false;
        if (state.mode !== "pan") {
          els.stageWrap.classList.remove("is-panning", "dragging");
        }
      }
    });

    els.selectedSelect.addEventListener("change", () => selectHotspot(els.selectedSelect.value));
    els.metaToggleBtn.addEventListener("click", () => {
      els.metaSection.classList.toggle("hidden");
      const isOpen = !els.metaSection.classList.contains("hidden");
      els.metaToggleBtn.textContent = (isOpen ? "− " : "+ ") + "Optional metadata";
    });
    ["hotTitle", "hotLabel", "hotGuidance", "hotMeta", "hotColor"].forEach((id) => {
      els[id].addEventListener("input", syncEditorText);
    });
    ["hotX", "hotY", "hotW", "hotH"].forEach((id) => {
      els[id].addEventListener("input", syncEditorGeometry);
    });
    els.deleteBtn.addEventListener("click", deleteSelectedHotspot);
    els.duplicateBtn.addEventListener("click", duplicateSelectedHotspot);
    els.listTabBtn.addEventListener("click", () => switchPanelTab("list"));
    els.editorTabBtn.addEventListener("click", () => switchPanelTab("editor"));
    els.userModeBtn.addEventListener("click", () => setViewMode("user"));
    els.editorModeBtn.addEventListener("click", requestEditorMode);
    els.signOutBtn.addEventListener("click", signOutEditor);
    els.editorCancelBtn.addEventListener("click", closeEditorModal);
    els.editorSubmitBtn.addEventListener("click", submitEditorLogin);
    els.editorPassword.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submitEditorLogin();
      if (event.key === "Escape") closeEditorModal();
    });
    els.editorEmail.addEventListener("keydown", (event) => {
      if (event.key === "Enter") els.editorPassword.focus();
    });
  }

  function newProject() {
    if (state.dirty && !window.confirm("Start a new project? Unsaved changes will be saved first.")) {
      return;
    }
    if (state.dirty) {
      saveProject(false);
    }
    Object.assign(state, {
      projectId: newId(),
      title: "Untitled training guide",
      image: "",
      imagePath: "",
      imageName: "",
      imageWidth: 0,
      imageHeight: 0,
      published: false,
      hotspots: [],
      selectedId: "",
      zoom: "fit",
      dirty: false
    });
    els.projectTitle.value = state.title;
    els.imageInput.value = "";
    render();
    setMode("draw");
    setStatus("New project ready");
  }

  function handleImageUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      state.imageWidth = img.naturalWidth;
      state.imageHeight = img.naturalHeight;
      state.imageName = file.name;
      state.selectedId = "";
      // Show immediately from the local file while we upload.
      state.image = localUrl;
      render();
      applyZoom();
      setStatus("Uploading image…");
      try {
        const path = await uploadImage(file);
        state.imagePath = path;
        state.image = publicUrl(path);
        setStatus("Image uploaded");
        render();
        markDirty();
      } catch (err) {
        setStatus("Image upload failed: " + (err.message || err));
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(localUrl), 5000);
      }
    };
    img.onerror = () => setStatus("Could not read that image file");
    img.src = localUrl;
    event.target.value = "";
  }

  function onStagePointerDown(event) {
    if (!state.image) return;
    hideCanvasTip();

    const panRequested = state.mode === "pan" || state.isSpaceDown || event.button === 1;
    if (panRequested) {
      startPan(event);
      return;
    }

    const box = event.target.closest(".hotspotBox");
    const handle = event.target.closest(".resizeHandle");

    if (box) {
      event.preventDefault();
      event.stopPropagation();
      const hotspot = getHotspot(box.dataset.id);
      if (!hotspot) return;
      selectHotspot(hotspot.id);
      if (handle) {
        startResize(event, hotspot);
      } else if (state.mode !== "draw") {
        startMove(event, hotspot);
      }
      return;
    }

    if (state.mode !== "draw") {
      selectHotspot("");
      return;
    }

    const point = eventToPercent(event);
    if (!point) return;

    event.preventDefault();
    const hotspot = {
      id: makeId("hotspot"),
      title: "New hotspot",
      label: `Hotspot ${state.hotspots.length + 1}`,
      guidance: "",
      meta: "",
      x: clamp(point.x, 0, 100),
      y: clamp(point.y, 0, 100),
      w: MIN_SIZE,
      h: MIN_SIZE
    };
    state.hotspots.push(hotspot);
    state.selectedId = hotspot.id;
    state.action = {
      type: "draw",
      id: hotspot.id,
      startX: point.x,
      startY: point.y
    };
    els.stageWrap.setPointerCapture(event.pointerId);
    render();
  }

  function onStagePointerMove(event) {
    if (!state.action) return;

    if (state.action.type === "pan") {
      event.preventDefault();
      els.stageWrap.scrollLeft = state.action.scrollLeft - (event.clientX - state.action.clientX);
      els.stageWrap.scrollTop = state.action.scrollTop - (event.clientY - state.action.clientY);
      return;
    }

    const point = eventToPercent(event);
    const hotspot = getHotspot(state.action.id);
    if (!point || !hotspot) return;

    event.preventDefault();
    if (state.action.type === "draw") {
      applyBoxFromPoints(hotspot, state.action.startX, state.action.startY, point.x, point.y);
    }
    if (state.action.type === "move") {
      hotspot.x = clamp(state.action.startHotspot.x + point.x - state.action.startPointer.x, 0, 100 - hotspot.w);
      hotspot.y = clamp(state.action.startHotspot.y + point.y - state.action.startPointer.y, 0, 100 - hotspot.h);
    }
    if (state.action.type === "resize") {
      hotspot.w = clamp(state.action.startHotspot.w + point.x - state.action.startPointer.x, MIN_SIZE, 100 - hotspot.x);
      hotspot.h = clamp(state.action.startHotspot.h + point.y - state.action.startPointer.y, MIN_SIZE, 100 - hotspot.y);
    }

    renderHotspotBoxes();
    populateEditor();
  }

  function endPointerAction(event) {
    if (!state.action) return;
    if (state.action.type !== "pan") {
      const hotspot = getHotspot(state.action.id);
      if (hotspot && (hotspot.w < MIN_SIZE || hotspot.h < MIN_SIZE)) {
        hotspot.w = Math.max(hotspot.w, MIN_SIZE);
        hotspot.h = Math.max(hotspot.h, MIN_SIZE);
      }
      render();
      markDirty();
    }
    if (state.action.type === "pan") {
      els.stageWrap.classList.remove("dragging");
    }
    try {
      els.stageWrap.releasePointerCapture(event.pointerId);
    } catch (err) {
      // Pointer capture can already be gone after cancel events.
    }
    state.action = null;
  }

  function startPan(event) {
    event.preventDefault();
    state.action = {
      type: "pan",
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: els.stageWrap.scrollLeft,
      scrollTop: els.stageWrap.scrollTop
    };
    els.stageWrap.classList.add("is-panning", "dragging");
    els.stageWrap.setPointerCapture(event.pointerId);
  }

  function startMove(event, hotspot) {
    const point = eventToPercent(event);
    if (!point) return;
    state.action = {
      type: "move",
      id: hotspot.id,
      startPointer: point,
      startHotspot: { x: hotspot.x, y: hotspot.y, w: hotspot.w, h: hotspot.h }
    };
    els.stageWrap.setPointerCapture(event.pointerId);
  }

  function startResize(event, hotspot) {
    const point = eventToPercent(event);
    if (!point) return;
    state.action = {
      type: "resize",
      id: hotspot.id,
      startPointer: point,
      startHotspot: { x: hotspot.x, y: hotspot.y, w: hotspot.w, h: hotspot.h }
    };
    els.stageWrap.setPointerCapture(event.pointerId);
  }

  function eventToPercent(event) {
    const img = els.stage.querySelector("img");
    if (!img || !state.imageWidth || !state.imageHeight) return null;
    const rect = img.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100)
    };
  }

  function applyBoxFromPoints(hotspot, x1, y1, x2, y2) {
    const left = clamp(Math.min(x1, x2), 0, 100);
    const top = clamp(Math.min(y1, y2), 0, 100);
    const right = clamp(Math.max(x1, x2), left + MIN_SIZE, 100);
    const bottom = clamp(Math.max(y1, y2), top + MIN_SIZE, 100);
    hotspot.x = left;
    hotspot.y = top;
    hotspot.w = right - left;
    hotspot.h = bottom - top;
  }

  function setMode(mode) {
    state.mode = mode;
    els.drawBtn.classList.toggle("active", mode === "draw");
    els.selectBtn.classList.toggle("active", mode === "select");
    els.panBtn.classList.toggle("active", mode === "pan");
    els.modeText.textContent = `Mode: ${mode === "draw" ? "add hotspot" : mode === "select" ? "select / move" : "pan view"}`;
    els.stageWrap.classList.toggle("is-panning", mode === "pan");
  }

  function render() {
    els.projectTitle.value = state.title;
    els.publishToggle.checked = Boolean(state.published);
    renderStage();
    renderHotspotBoxes();
    renderLists();
    populateEditor();
    updateButtons();
    updateTopbarMeta();
  }

  function updateTopbarMeta() {
    if (state.viewMode === "editor") {
      els.topbarMeta.textContent = `Editing: ${state.title}${state.published ? " · Published" : " · Draft"}`;
    } else {
      els.topbarMeta.textContent = "";
    }
  }

  function renderStage() {
    els.stage.innerHTML = "";
    els.stage.classList.toggle("has-image", Boolean(state.image));
    if (!state.image) {
      els.stage.style.width = "";
      els.stage.style.height = "";
      els.stage.style.transform = "";
      els.stage.innerHTML = '<div class="placeholder"><div><h2>Load a SystmOne screenshot to start</h2><p>Then click <b>Add hotspot</b> and draw boxes over the sections staff need guidance on.</p></div></div>';
      return;
    }

    const img = document.createElement("img");
    img.src = state.image;
    img.alt = state.imageName || "Uploaded application screenshot";
    img.width = state.imageWidth;
    img.height = state.imageHeight;
    els.stage.appendChild(img);
    applyZoom();
  }

  function renderHotspotBoxes() {
    els.stage.querySelectorAll(".hotspotBox").forEach((node) => node.remove());
    if (!state.image) return;

    state.hotspots.forEach((hotspot) => {
      const box = document.createElement("div");
      box.className = "hotspotBox";
      box.dataset.id = hotspot.id;
      box.classList.toggle("selected", hotspot.id === state.selectedId);
      box.style.left = `${hotspot.x}%`;
      box.style.top = `${hotspot.y}%`;
      box.style.width = `${hotspot.w}%`;
      box.style.height = `${hotspot.h}%`;
      const color = hexToRgb(hotspot.color || "#ffc857");
      box.style.borderColor = `rgba(17, 24, 39, 0.4)`;
      const isSelected = hotspot.id === state.selectedId;
      box.style.backgroundColor = `rgba(${color.r}, ${color.g}, ${color.b}, ${isSelected ? 0.25 : 0.08})`;
      box.setAttribute("role", "button");
      box.setAttribute("tabindex", "0");
      box.setAttribute("aria-label", hotspot.title || hotspot.label || "Hotspot");

      const label = document.createElement("div");
      label.className = "hotspotLabel";
      label.textContent = hotspot.label || hotspot.title || "Hotspot";
      box.appendChild(label);

      const handle = document.createElement("div");
      handle.className = "resizeHandle";
      handle.setAttribute("aria-hidden", "true");
      box.appendChild(handle);

      box.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectHotspot(hotspot.id);
          setMode("select");
        }
      });

      // WYSIWYG guidance preview: hover shows the same tooltip users will see.
      box.addEventListener("mouseenter", (event) => {
        box.style.backgroundColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.25)`;
        showCanvasTip(hotspot, event);
      });
      box.addEventListener("mousemove", moveCanvasTip);
      box.addEventListener("mouseleave", (event) => {
        if (!box.classList.contains("selected")) {
          box.style.backgroundColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.08)`;
        }
        hideCanvasTip(event);
      });
      box.addEventListener("focus", (event) => {
        box.style.backgroundColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.25)`;
        showCanvasTip(hotspot, event);
      });
      box.addEventListener("blur", (event) => {
        if (!box.classList.contains("selected")) {
          box.style.backgroundColor = `rgba(${color.r}, ${color.g}, ${color.b}, 0.08)`;
        }
        hideCanvasTip(event);
      });

      els.stage.appendChild(box);
    });
  }

  function showCanvasTip(hotspot, event) {
    if (state.action) return;
    els.canvasTip.textContent = "";
    const heading = document.createElement("h3");
    heading.textContent = hotspot.title || hotspot.label || "Hotspot";
    const body = document.createElement("p");
    body.textContent = hotspot.guidance || "No guidance added yet.";
    els.canvasTip.appendChild(heading);
    els.canvasTip.appendChild(body);
    if (hotspot.meta) {
      const meta = document.createElement("div");
      meta.className = "tipMeta";
      meta.textContent = hotspot.meta;
      els.canvasTip.appendChild(meta);
    }
    els.canvasTip.classList.add("show");
    positionCanvasTip(tipPointFromEvent(event));
  }

  function moveCanvasTip(event) {
    if (!els.canvasTip.classList.contains("show")) return;
    positionCanvasTip(tipPointFromEvent(event));
  }

  function hideCanvasTip() {
    els.canvasTip.classList.remove("show");
  }

  function tipPointFromEvent(event) {
    if (event && typeof event.clientX === "number" && event.clientX !== 0) {
      return { clientX: event.clientX, clientY: event.clientY };
    }
    const target = event && event.currentTarget;
    if (target && target.getBoundingClientRect) {
      const rect = target.getBoundingClientRect();
      return { clientX: rect.left, clientY: rect.bottom };
    }
    return { clientX: window.innerWidth / 2, clientY: 120 };
  }

  function positionCanvasTip(point) {
    const pad = 12;
    const offset = 18;
    const rect = els.canvasTip.getBoundingClientRect();
    let left = point.clientX + offset;
    let top = point.clientY + offset;
    if (left + rect.width + pad > window.innerWidth) left = point.clientX - rect.width - offset;
    if (top + rect.height + pad > window.innerHeight) top = window.innerHeight - rect.height - pad;
    els.canvasTip.style.left = `${Math.max(pad, left)}px`;
    els.canvasTip.style.top = `${Math.max(pad, top)}px`;
  }

  function switchPanelTab(tab) {
    if (tab === "list") {
      els.listView.classList.remove("hidden");
      els.editorView.classList.add("hidden");
      els.listTabBtn.classList.add("active");
      els.editorTabBtn.classList.remove("active");
    } else {
      els.editorView.classList.remove("hidden");
      els.listView.classList.add("hidden");
      els.editorTabBtn.classList.add("active");
      els.listTabBtn.classList.remove("active");
    }
  }

  function renderLists() {
    els.hotspotListPanel.innerHTML = "";
    els.selectedSelect.innerHTML = "";

    if (!state.hotspots.length) {
      const empty = document.createElement("p");
      empty.className = "emptyState";
      empty.textContent = "No hotspots yet.";
      els.hotspotListPanel.appendChild(empty);
    }

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = state.hotspots.length ? "Choose a hotspot" : "No hotspots";
    els.selectedSelect.appendChild(defaultOption);

    state.hotspots.forEach((hotspot, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "hotspotItem";
      item.classList.toggle("is-selected", hotspot.id === state.selectedId);
      item.innerHTML = `<span><strong></strong><span></span></span><span class="pill">${index + 1}</span>`;
      item.querySelector("strong").textContent = hotspot.title || hotspot.label || `Hotspot ${index + 1}`;
      item.querySelector("span span").textContent = hotspot.label || "No short label";
      item.addEventListener("click", () => {
        selectHotspot(hotspot.id);
        switchPanelTab("editor");
        setMode("select");
      });
      els.hotspotListPanel.appendChild(item);

      const option = document.createElement("option");
      option.value = hotspot.id;
      option.textContent = `${index + 1}. ${hotspot.title || hotspot.label || "Untitled hotspot"}`;
      els.selectedSelect.appendChild(option);
    });
    els.selectedSelect.value = state.selectedId;
  }

  function populateEditor() {
    const hotspot = getHotspot(state.selectedId);
    const disabled = !hotspot;

    ["hotTitle", "hotLabel", "hotGuidance", "hotMeta", "hotColor", "hotX", "hotY", "hotW", "hotH"].forEach((id) => {
      els[id].disabled = disabled;
    });

    if (!hotspot) {
      els.hotTitle.value = "";
      els.hotLabel.value = "";
      els.hotGuidance.value = "";
      els.hotMeta.value = "";
      els.hotColor.value = "#ffc857";
      els.hotX.value = "";
      els.hotY.value = "";
      els.hotW.value = "";
      els.hotH.value = "";
      els.selectedSelect.value = "";
      updateButtons();
      return;
    }

    els.hotTitle.value = hotspot.title || "";
    els.hotLabel.value = hotspot.label || "";
    els.hotGuidance.value = hotspot.guidance || "";
    els.hotMeta.value = hotspot.meta || "";
    els.hotColor.value = hotspot.color || "#ffc857";
    els.hotX.value = round(hotspot.x);
    els.hotY.value = round(hotspot.y);
    els.hotW.value = round(hotspot.w);
    els.hotH.value = round(hotspot.h);
    els.selectedSelect.value = hotspot.id;
    updateButtons();
  }

  function syncEditorText() {
    const hotspot = getHotspot(state.selectedId);
    if (!hotspot) return;
    hotspot.title = els.hotTitle.value;
    hotspot.label = els.hotLabel.value;
    hotspot.guidance = els.hotGuidance.value;
    hotspot.meta = els.hotMeta.value;
    hotspot.color = els.hotColor.value;
    renderHotspotBoxes();
    renderLists();
    markDirty();
  }

  function syncEditorGeometry() {
    const hotspot = getHotspot(state.selectedId);
    if (!hotspot) return;
    const x = numberFrom(els.hotX.value, hotspot.x);
    const y = numberFrom(els.hotY.value, hotspot.y);
    const w = numberFrom(els.hotW.value, hotspot.w);
    const h = numberFrom(els.hotH.value, hotspot.h);
    hotspot.x = clamp(x, 0, 100 - MIN_SIZE);
    hotspot.y = clamp(y, 0, 100 - MIN_SIZE);
    hotspot.w = clamp(w, MIN_SIZE, 100 - hotspot.x);
    hotspot.h = clamp(h, MIN_SIZE, 100 - hotspot.y);
    renderHotspotBoxes();
    markDirty();
  }

  function selectHotspot(id) {
    state.selectedId = id || "";
    renderHotspotBoxes();
    renderLists();
    populateEditor();
  }

  function deleteSelectedHotspot() {
    if (!state.selectedId) return;
    state.hotspots = state.hotspots.filter((hotspot) => hotspot.id !== state.selectedId);
    state.selectedId = state.hotspots[0] ? state.hotspots[0].id : "";
    render();
    markDirty();
  }

  function duplicateSelectedHotspot() {
    const hotspot = getHotspot(state.selectedId);
    if (!hotspot) return;
    const copy = {
      ...hotspot,
      id: makeId("hotspot"),
      title: `${hotspot.title || "Hotspot"} copy`,
      x: clamp(hotspot.x + 2, 0, 100 - hotspot.w),
      y: clamp(hotspot.y + 2, 0, 100 - hotspot.h)
    };
    state.hotspots.push(copy);
    state.selectedId = copy.id;
    render();
    markDirty();
  }

  function updateButtons() {
    const hasSelection = Boolean(state.selectedId);
    const hasImage = Boolean(state.image);
    els.deleteBtn.disabled = !hasSelection;
    els.duplicateBtn.disabled = !hasSelection;
    els.drawBtn.disabled = !hasImage;
    els.selectBtn.disabled = !hasImage;
    els.panBtn.disabled = !hasImage;
    els.fitBtn.disabled = !hasImage;
    els.actualBtn.disabled = !hasImage;
  }

  function applyZoom() {
    if (!state.image || !state.imageWidth || !state.imageHeight) return;
    const previousScale = state.scale;
    const horizontalPadding = 24;
    const verticalPadding = 24;
    if (state.zoom === "actual") {
      state.scale = 1;
    } else if (state.zoom === "fit-width") {
      const scaleX = (els.stageWrap.clientWidth - horizontalPadding) / state.imageWidth;
      state.scale = Math.min(1, Math.max(0.08, scaleX));
    } else {
      const scaleX = (els.stageWrap.clientWidth - horizontalPadding) / state.imageWidth;
      const scaleY = (els.stageWrap.clientHeight - verticalPadding) / state.imageHeight;
      state.scale = Math.min(1, Math.max(0.08, Math.min(scaleX, scaleY)));
    }
    els.stage.style.width = `${Math.round(state.imageWidth * state.scale)}px`;
    els.stage.style.height = `${Math.round(state.imageHeight * state.scale)}px`;
    els.stage.style.transform = "";
    els.stage.style.margin = "12px";
    els.stage.style.marginRight = "12px";
    els.stage.style.marginBottom = "12px";
    els.zoomText.textContent = state.zoom === "actual" ? "Zoom: 100%" : `Zoom: ${Math.round(state.scale * 100)}%`;
    if (state.zoom === "fit" || state.zoom === "fit-width" || previousScale !== state.scale) {
      positionStageForFit(false);
    }
  }

  function positionStageForFit() {
    if (state.zoom !== "fit" && state.zoom !== "fit-width") return;
    els.stage.style.marginLeft = "12px";
    els.stage.style.marginTop = "12px";
  }

  function markDirty() {
    state.dirty = true;
    window.clearTimeout(state.saveTimer);
    setStatus("Unsaved changes");
    state.saveTimer = window.setTimeout(() => saveProject(false), 700);
  }

  async function saveProject(showMessage) {
    if (!state.isEditor) return;
    const row = getSerializableRow();
    setStatus("Saving…");
    try {
      const session = await currentSession();
      row.updated_by = session && session.user ? session.user.id : null;
      const saved = await saveRow(row);
      state.dirty = false;
      if (saved && saved.created_at) state.createdAt = saved.created_at;
      setStatus("Saved");
      await refreshProjects(state.projectId);
      renderPublicCatalog();
    } catch (err) {
      setStatus("Save failed: " + (err.message || err));
    }
  }

  async function refreshProjects(selectId) {
    let rows = [];
    try {
      rows = await listAllRows();
    } catch (err) {
      setStatus("Could not load the page list: " + (err.message || err));
    }
    els.projectList.innerHTML = "";
    if (!rows.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No saved pages";
      els.projectList.appendChild(option);
      return;
    }
    rows.forEach((row) => {
      const option = document.createElement("option");
      option.value = row.id;
      const flag = row.published ? "" : " (draft)";
      option.textContent = `${row.title || "Untitled"}${flag} — ${formatDate(row.updated_at)}`;
      els.projectList.appendChild(option);
    });
    els.projectList.value = selectId || state.projectId;
  }

  async function loadSelectedProject() {
    const id = els.projectList.value;
    if (!id || id === state.projectId) return;

    // Release old lock if we have one
    if (state.hasLock) {
      await releaseLock(state.projectId);
    }

    let row = null;
    try {
      row = await getRow(id);
    } catch (err) {
      setStatus("Could not load that page: " + (err.message || err));
      return;
    }
    if (!row) {
      setStatus("Page was not found");
      return;
    }
    loadProject(rowToProject(row));

    // Acquire lock for new page
    if (state.isEditor) {
      await acquireLock(id);
    }

    setStatus("Page loaded");
  }

  async function deleteSelectedProject() {
    const id = els.projectList.value;
    if (!id) return;
    if (!window.confirm("Delete this training page for everyone? This cannot be undone.")) return;
    let imagePath = state.projectId === id ? state.imagePath : "";
    try {
      if (!imagePath) {
        const row = await getRow(id);
        imagePath = row && row.image_path;
      }
      await deleteRow(id);
      if (imagePath) await removeImage(imagePath);
    } catch (err) {
      setStatus("Could not delete that page: " + (err.message || err));
      return;
    }
    if (id === state.projectId) {
      newProject();
    }
    refreshProjects();
    renderPublicCatalog();
    setStatus("Page deleted");
  }

  function loadProject(project) {
    Object.assign(state, project, { action: null, dirty: false });
    els.projectTitle.value = state.title;
    els.imageInput.value = "";
    render();
    applyZoom();
  }

  // Convert the live editor state into a training_pages row.
  function getSerializableRow() {
    return {
      id: state.projectId,
      title: state.title,
      published: Boolean(state.published),
      image_path: state.imagePath || null,
      image_width: state.imageWidth || null,
      image_height: state.imageHeight || null,
      hotspots: state.hotspots,
      updated_at: new Date().toISOString()
    };
  }

  // Convert a training_pages row into the live editor state shape.
  function rowToProject(row) {
    const imagePath = row.image_path || "";
    return {
      projectId: row.id,
      title: row.title || "Untitled training guide",
      imagePath: imagePath,
      image: imagePath ? publicUrl(imagePath) : "",
      imageName: row.title || "",
      imageWidth: Number(row.image_width) || 0,
      imageHeight: Number(row.image_height) || 0,
      published: Boolean(row.published),
      hotspots: Array.isArray(row.hotspots) ? row.hotspots.map(normalizeHotspot) : [],
      selectedId: "",
      zoom: "fit",
      scale: 1,
      createdAt: row.created_at || new Date().toISOString()
    };
  }

  // Build the project object the public renderer expects from a row.
  function rowToPublic(row) {
    return {
      id: row.id,
      title: row.title || "Untitled training page",
      image: row.image_path ? publicUrl(row.image_path) : "",
      imageName: row.title || "",
      hotspots: Array.isArray(row.hotspots) ? row.hotspots : []
    };
  }

  function normalizeHotspot(hotspot, index) {
    return {
      id: hotspot.id || makeId("hotspot"),
      title: hotspot.title || `Hotspot ${index + 1}`,
      label: hotspot.label || "",
      guidance: hotspot.guidance || "",
      meta: hotspot.meta || "",
      x: clamp(Number(hotspot.x) || 0, 0, 98.8),
      y: clamp(Number(hotspot.y) || 0, 0, 98.8),
      w: clamp(Number(hotspot.w) || 10, MIN_SIZE, 100),
      h: clamp(Number(hotspot.h) || 10, MIN_SIZE, 100)
    };
  }

  function buildTrainingHtml(source) {
    const project = source || {
      title: state.title,
      image: state.image,
      imageName: state.imageName,
      hotspots: state.hotspots
    };
    const safeTitle = escapeHtml(project.title);
    const hotspots = Array.isArray(project.hotspots) ? project.hotspots : [];
    const hotspotData = JSON.stringify(hotspots).replace(/</g, "\\u003c");
    const image = project.image || "";
    const imageAlt = escapeHtml(project.imageName || project.title || "Training screenshot");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f8fc; color: #212b32; font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; -webkit-font-smoothing: antialiased; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 22px; background: #d8efff; color: #003d78; border-bottom: 1px solid #7fb9e6; }
    .topbar h1 { margin: 0; font-size: 1.2rem; font-weight: 800; letter-spacing: -0.01em; color: #0a2d5e; }
    .topbar p { margin: 3px 0 0; color: #003d78; opacity: 0.85; font-size: 0.88rem; }
    .topbar .count { display: inline-flex; align-items: center; padding: 0.3rem 0.7rem; border-radius: 999px; background: #005eb8; color: #fff; font-size: 0.8rem; font-weight: 700; white-space: nowrap; }
    .topbar .flashBtn { padding: 8px 14px; border: none; border-radius: 6px; background: #005eb8; color: #fff; font-weight: 700; font-size: 0.9rem; cursor: pointer; }
    .topbar .flashBtn.active { background: #0f7bdc; }
    .main { padding: 24px; }
    .contentShell { max-width: 1600px; margin: 0 auto; }
    .screen { position: relative; width: 100%; background: #fff; border: 1px solid #d8dde0; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(16, 32, 51, 0.07); }
    .screen img { display: block; width: 100%; height: auto; }
    .spot { position: absolute; border: 2px dashed rgba(0, 94, 184, 0.45); border-radius: 4px; background: rgba(0, 94, 184, 0.08); cursor: help; transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease; }
    .spot:hover, .spot:focus, .spot.active { border-style: solid; border-color: #005eb8; background: rgba(0, 94, 184, 0.16); outline: 0; box-shadow: 0 0 0 2px rgba(255,255,255,.92), 0 10px 30px rgba(0, 94, 184, .22); }
    .spot.visited { border-color: #157347; }
    .spot.visited::after { content: "✓"; position: absolute; top: 4px; right: 5px; width: 16px; height: 16px; border-radius: 999px; display: grid; place-items: center; background: #157347; color: #fff; font-size: 11px; font-weight: 800; line-height: 1; }
    .spot.unviewed.flash { animation: flash 0.6s ease-in-out 2; }
    .spot span { position: absolute; left: -2px; top: -30px; display: none; max-width: min(300px, 82vw); overflow: hidden; border-radius: 5px; background: #005eb8; color: #fff; padding: 4px 8px; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; }
    .spot:hover span, .spot:focus span, .spot.active span { display: block; }
    .tip { position: fixed; z-index: 10; display: none; width: min(360px, calc(100vw - 24px)); border: 1px solid #d8dde0; border-left: 4px solid #005eb8; border-radius: 8px; background: #fff; padding: 16px; box-shadow: 0 16px 36px rgba(16, 32, 51, 0.18); }
    .tip.show { display: block; }
    .tip h2 { margin: 0 0 8px; font-size: 1.05rem; font-weight: 700; color: #212b32; }
    .tip p { margin: 0; color: #334e68; white-space: pre-wrap; font-size: 0.95rem; line-height: 1.5; }
    .tip .meta { margin-top: 10px; padding-top: 10px; border-top: 1px solid #d8dde0; color: #4c6272; font-size: .85rem; }
    .empty { padding: 48px 18px; color: #4c6272; text-align: center; }
    @keyframes flash { 0%, 100% { background: rgba(0, 94, 184, 0.08); border-color: rgba(0, 94, 184, 0.45); } 50% { background: rgba(255, 193, 7, 0.25); border-color: #ffc107; } }
    .spot.flash { animation: flash 0.6s ease-in-out; }
  </style>
</head>
<body>
  <header class="topbar">
    <div>
      <h1>${safeTitle}</h1>
      <p>Hover or tap a highlighted area for guidance.</p>
    </div>
    <div style="display: flex; gap: 12px; align-items: center;">
      ${hotspots.length ? '<button id="flashBtn" class="flashBtn" type="button">Flash unviewed</button>' : ""}
      <span class="count">${hotspots.length} hotspot${hotspots.length === 1 ? "" : "s"}</span>
    </div>
  </header>
  <main class="main">
    <div class="contentShell">
      ${image ? `<div class="screen" id="screen"><img src="${image}" alt="${imageAlt}"></div>` : '<p class="empty">This training page has no screenshot yet.</p>'}
      ${image && !hotspots.length ? '<p class="empty">No hotspots were added to this guide.</p>' : ""}
    </div>
  </main>
  <aside class="tip" id="tip" aria-live="polite"></aside>
  <script>
    const hotspots = ${hotspotData}.map((hotspot) => ({ ...hotspot, visited: false, timer: null }));
    const screen = document.getElementById("screen");
    const tip = document.getElementById("tip");
    if (screen) {
    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }
    function showTip(hotspot, event) {
      tip.innerHTML = "<h2>" + escapeHtml(hotspot.title || hotspot.label || "Hotspot") + "</h2><p>" + escapeHtml(hotspot.guidance || "No guidance has been added.") + "</p>" + (hotspot.meta ? '<div class="meta">' + escapeHtml(hotspot.meta) + "</div>" : "");
      tip.classList.add("show");
      moveTip(event || { clientX: window.innerWidth / 2, clientY: 120 });
    }
    function moveTip(event) {
      if (!tip.classList.contains("show")) return;
      const pad = 12;
      const offset = 18;
      const rect = tip.getBoundingClientRect();
      let left = event.clientX + offset;
      let top = event.clientY + offset;
      if (left + rect.width + pad > window.innerWidth) left = event.clientX - rect.width - offset;
      if (top + rect.height + pad > window.innerHeight) top = window.innerHeight - rect.height - pad;
      tip.style.left = Math.max(pad, left) + "px";
      tip.style.top = Math.max(pad, top) + "px";
    }
    function hideTip() {
      tip.classList.remove("show");
      document.querySelectorAll(".spot.active").forEach((node) => node.classList.remove("active"));
    }
    const flashBtn = document.getElementById("flashBtn");
    function markVisited(hotspot, spot) {
      hotspot.visited = true;
      spot.classList.add("visited");
      spot.classList.remove("unviewed", "flash");
    }
    function startVisitTimer(hotspot, spot, event) {
      clearTimeout(hotspot.timer);
      hotspot.timer = setTimeout(() => {
        markVisited(hotspot, spot);
        showTip(hotspot, event);
      }, 2000);
    }
    function clearVisitTimer(hotspot) {
      clearTimeout(hotspot.timer);
      hotspot.timer = null;
    }
    function flashUnviewed() {
      const unviewed = hotspots.filter((hotspot) => !hotspot.visited);
      if (!unviewed.length) return;
      flashBtn.classList.add("active");
      unviewed.forEach((hotspot) => {
        const spot = document.querySelector('.spot[data-id="' + hotspot.id + '"]');
        if (!spot) return;
        spot.classList.add("flash", "unviewed");
        window.setTimeout(() => spot.classList.remove("flash"), 1200);
      });
      window.setTimeout(() => flashBtn.classList.remove("active"), 900);
    }
    if (flashBtn) flashBtn.addEventListener("click", flashUnviewed);
    hotspots.forEach((hotspot, index) => {
      const spot = document.createElement("button");
      spot.type = "button";
      spot.className = "spot";
      spot.dataset.id = hotspot.id;
      spot.classList.add("unviewed");
      spot.style.left = hotspot.x + "%";
      spot.style.top = hotspot.y + "%";
      spot.style.width = hotspot.w + "%";
      spot.style.height = hotspot.h + "%";
      spot.setAttribute("aria-label", hotspot.title || hotspot.label || "Hotspot");
      const label = document.createElement("span");
      label.textContent = hotspot.label || hotspot.title || "Hotspot";
      spot.appendChild(label);
      spot.addEventListener("mouseenter", (event) => {
        spot.classList.add("active");
        startVisitTimer(hotspot, spot, event);
      });
      spot.addEventListener("mousemove", moveTip);
      spot.addEventListener("mouseleave", () => {
        clearVisitTimer(hotspot);
        spot.classList.remove("active");
        hideTip();
      });
      spot.addEventListener("focus", (event) => {
        spot.classList.add("active");
        startVisitTimer(hotspot, spot, event);
      });
      spot.addEventListener("blur", () => {
        clearVisitTimer(hotspot);
        spot.classList.remove("active");
        hideTip();
      });
      spot.addEventListener("click", (event) => {
        spot.classList.add("active");
        showTip(hotspot, event);
      });
      spot.addEventListener("touchstart", (event) => {
        spot.classList.add("active");
        startVisitTimer(hotspot, spot, event.touches[0]);
      });
      screen.appendChild(spot);
    });
    }
  </script>
</body>
</html>`;
  }

  // ----- Supabase data access -----

  function requireBackend() {
    if (!SB) throw new Error("Supabase is not configured");
    return SB;
  }

  async function listAllRows() {
    const { data, error } = await requireBackend()
      .from(TABLE)
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function listPublishedRows() {
    const { data, error } = await requireBackend()
      .from(TABLE)
      .select("*")
      .eq("published", true)
      .order("title", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function getRow(id) {
    const { data, error } = await requireBackend()
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function saveRow(row) {
    const { data, error } = await requireBackend()
      .from(TABLE)
      .upsert(row)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function deleteRow(id) {
    const { error } = await requireBackend().from(TABLE).delete().eq("id", id);
    if (error) throw error;
  }

  async function uploadImage(file) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${newId()}.${ext || "png"}`;
    const { error } = await requireBackend()
      .storage.from(BUCKET)
      .upload(path, file, { contentType: file.type || "image/png", upsert: false });
    if (error) throw error;
    return path;
  }

  async function removeImage(path) {
    if (!path) return;
    try {
      await requireBackend().storage.from(BUCKET).remove([path]);
    } catch (err) {
      // Non-fatal: the row is already gone; a stray image is harmless.
    }
  }

  function publicUrl(path) {
    if (!SB || !path) return "";
    return SB.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  // ----- Auth (editors = MyMedInfo admins) -----

  async function currentSession() {
    if (!SB) return null;
    const { data } = await SB.auth.getSession();
    return data ? data.session : null;
  }

  async function checkEditor() {
    if (!SB) return false;
    const { data, error } = await SB.rpc("is_training_editor");
    if (error) return false;
    return data === true;
  }

  async function acquireLock(pageId) {
    if (!SB || !pageId) return false;
    const { data, error } = await SB.rpc("acquire_training_lock", { page_id: pageId });
    if (error) {
      setStatus("Error acquiring lock: " + (error.message || error));
      return false;
    }
    if (!data[0].success) {
      const lockedBy = data[0].locked_by_user_id;
      const lockedAt = data[0].locked_at_time;
      setStatus(`Page locked by another user (locked at ${new Date(lockedAt).toLocaleTimeString()})`);
      return false;
    }
    state.hasLock = true;
    startLockHeartbeat();
    setStatus("Lock acquired");
    return true;
  }

  async function releaseLock(pageId) {
    if (!SB || !pageId || !state.hasLock) return;
    window.clearTimeout(state.lockRefreshTimer);
    state.hasLock = false;
    const { error } = await SB.rpc("release_training_lock", { page_id: pageId });
    if (error) {
      console.warn("Error releasing lock:", error);
    }
  }

  function startLockHeartbeat() {
    window.clearTimeout(state.lockRefreshTimer);
    state.lockRefreshTimer = window.setInterval(() => {
      if (state.hasLock && state.projectId) {
        acquireLock(state.projectId).catch(err => console.warn("Lock refresh failed:", err));
      }
    }, 5 * 60 * 1000); // Refresh every 5 minutes
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function getHotspot(id) {
    return state.hotspots.find((hotspot) => hotspot.id === id);
  }

  function setStatus(message) {
    els.saveStatus.textContent = message;
  }

  // ----- View mode (User view vs Editor) -----

  function setViewMode(mode) {
    state.viewMode = mode;
    applyViewMode();
    if (mode === "user") {
      renderPublicCatalog();
    } else {
      applyZoom();
    }
  }

  function applyViewMode() {
    const editor = state.viewMode === "editor";
    document.body.classList.toggle("mode-editor", editor);
    document.body.classList.toggle("mode-user", !editor);
    els.editorShell.hidden = !editor;
    els.userShell.hidden = editor;
    els.userModeBtn.classList.toggle("active", !editor);
    els.editorModeBtn.classList.toggle("active", editor);
    updateTopbarMeta();
  }

  async function requestEditorMode() {
    setStatus("Checking access…");
    const session = await currentSession();
    if (session) {
      state.isEditor = await checkEditor();
      if (state.isEditor) {
        await enterEditor();
        return;
      }
    }
    openEditorModal();
  }

  async function enterEditor() {
    setViewMode("editor");
    setStatus("Ready");
    await refreshProjects(state.projectId);
    if (state.projectId) {
      // Try to acquire lock, but continue even if it fails (lock system might not be set up)
      acquireLock(state.projectId).catch(err => {
        console.warn("Lock acquisition failed (may not be configured):", err);
      });
    }
  }

  function openEditorModal() {
    els.editorModal.classList.remove("hidden");
    els.editorEmail.value = "";
    els.editorPassword.value = "";
    els.editorModalText.textContent = SB
      ? "Sign in with your MyMedInfo admin account to edit."
      : "Editing is unavailable: the backend is not configured.";
    els.editorEmail.focus();
  }

  function closeEditorModal() {
    els.editorModal.classList.add("hidden");
  }

  async function submitEditorLogin() {
    if (!SB) return;
    const email = els.editorEmail.value.trim();
    const password = els.editorPassword.value;
    if (!email || !password) {
      els.editorModalText.textContent = "Enter your email and password.";
      return;
    }
    els.editorModalText.textContent = "Signing in…";
    const { error } = await SB.auth.signInWithPassword({ email, password });
    if (error) {
      els.editorModalText.textContent = error.message || "Sign in failed.";
      return;
    }
    state.isEditor = await checkEditor();
    if (!state.isEditor) {
      els.editorModalText.textContent = "This account is not an authorised training editor.";
      await SB.auth.signOut();
      return;
    }
    closeEditorModal();
    await enterEditor();
  }

  async function signOutEditor() {
    await releaseLock(state.projectId);
    if (SB) await SB.auth.signOut();
    state.isEditor = false;
    setViewMode("user");
    setStatus("Signed out");
  }

  // ----- Public (user-facing) catalogue -----

  async function renderPublicCatalog() {
    let published = [];
    try {
      published = await listPublishedRows();
    } catch (err) {
      published = [];
    }

    els.publicPageList.innerHTML = "";

    if (!published.length) {
      const empty = document.createElement("p");
      empty.className = "emptyState";
      empty.textContent = SB
        ? "No training pages have been published yet."
        : "The backend is not configured yet.";
      els.publicPageList.appendChild(empty);
      showPublicPage(null);
      return;
    }

    if (!published.some((row) => row.id === state.publicPageId)) {
      state.publicPageId = published[0].id;
    }

    published.forEach((row) => {
      const count = (row.hotspots || []).length;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "hotspotItem";
      item.classList.toggle("is-selected", row.id === state.publicPageId);
      item.innerHTML = '<span><strong></strong><span></span></span>';
      item.querySelector("strong").textContent = row.title || "Untitled training page";
      item.querySelector("span span").textContent = `${count} hotspot${count === 1 ? "" : "s"}`;
      item.addEventListener("click", () => {
        state.publicPageId = row.id;
        renderPublicCatalog();
      });
      els.publicPageList.appendChild(item);
    });

    const current = published.find((row) => row.id === state.publicPageId) || published[0];
    showPublicPage(rowToPublic(current));
  }

  function showPublicPage(project) {
    if (!project) {
      els.publicFrame.srcdoc = "<!doctype html><html><body style=\"margin:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#4c6272;background:#f4f8fc;display:grid;place-items:center;height:100vh;\"><p>Select a published training page from the list.</p></body></html>";
      return;
    }
    els.publicFrame.srcdoc = buildTrainingHtml(project);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value) {
    return Math.round(value * 10) / 10;
  }

  function numberFrom(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function slugify(value) {
    return (value || "training-guide")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "training-guide";
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function formatDate(value) {
    if (!value) return "not saved";
    return new Date(value).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 255, g: 200, b: 87 };
  }

  function isTyping(target) {
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target && target.tagName);
  }
})();
