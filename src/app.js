(function () {
  "use strict";

  const DB_NAME = "s1-hotspot-training-builder";
  const DB_VERSION = 1;
  const STORE = "projects";
  const LS_KEY = "s1-hotspot-training-builder-projects";
  const PASS_KEY = "s1-hotspot-training-builder-editor-passhash";
  const SESSION_KEY = "s1-hotspot-training-builder-editor-unlocked";
  const MIN_SIZE = 1.2;

  const state = {
    projectId: makeId("project"),
    title: "Reception Visualisation Training",
    image: "",
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
    viewMode: "user",
    publicPageId: ""
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    [
      "projectTitle", "publishToggle", "newProjectBtn", "saveNowBtn", "projectList",
      "deleteProjectBtn", "saveStatus", "imageInput", "importBtn", "exportProjectBtn", "jsonInput",
      "hotspotList", "drawBtn", "selectBtn", "panBtn", "fitBtn", "actualBtn", "modeText", "zoomText",
      "stageWrap", "stage", "selectedSelect", "hotTitle", "hotLabel", "hotGuidance", "hotMeta", "hotX",
      "hotY", "hotW", "hotH", "deleteBtn", "duplicateBtn",
      "topbarMeta", "userModeBtn", "editorModeBtn", "userShell",
      "editorShell", "userRail", "publicPageList", "publicTitleText", "publicFrame", "canvasTip", "editorModal",
      "editorPassphrase", "editorSubmitBtn", "editorCancelBtn", "editorModalText"
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });

    wireEvents();
    setMode("draw");
    refreshProjects();
    render();
    setStatus("Autosave ready");
    applyViewMode();
    renderPublicCatalog();
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
    els.importBtn.addEventListener("click", () => els.jsonInput.click());
    els.jsonInput.addEventListener("change", handleJsonImport);
    els.exportProjectBtn.addEventListener("click", exportProjectJson);

    els.drawBtn.addEventListener("click", () => setMode("draw"));
    els.selectBtn.addEventListener("click", () => setMode("select"));
    els.panBtn.addEventListener("click", () => setMode("pan"));
    els.fitBtn.addEventListener("click", () => {
      state.zoom = "fit";
      applyZoom();
    });
    els.actualBtn.addEventListener("click", () => {
      state.zoom = "actual";
      applyZoom();
    });

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
    ["hotTitle", "hotLabel", "hotGuidance", "hotMeta"].forEach((id) => {
      els[id].addEventListener("input", syncEditorText);
    });
    ["hotX", "hotY", "hotW", "hotH"].forEach((id) => {
      els[id].addEventListener("input", syncEditorGeometry);
    });
    els.deleteBtn.addEventListener("click", deleteSelectedHotspot);
    els.duplicateBtn.addEventListener("click", duplicateSelectedHotspot);
    els.userModeBtn.addEventListener("click", () => setViewMode("user"));
    els.editorModeBtn.addEventListener("click", requestEditorMode);
    els.editorCancelBtn.addEventListener("click", closeEditorModal);
    els.editorSubmitBtn.addEventListener("click", submitEditorPassphrase);
    els.editorPassphrase.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submitEditorPassphrase();
      if (event.key === "Escape") closeEditorModal();
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
      projectId: makeId("project"),
      title: "Untitled training guide",
      image: "",
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

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        state.image = reader.result;
        state.imageName = file.name;
        state.imageWidth = img.naturalWidth;
        state.imageHeight = img.naturalHeight;
        state.selectedId = "";
        render();
        applyZoom();
        markDirty();
      };
      img.onerror = () => setStatus("Could not read that image file");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
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
      box.addEventListener("mouseenter", (event) => showCanvasTip(hotspot, event));
      box.addEventListener("mousemove", moveCanvasTip);
      box.addEventListener("mouseleave", hideCanvasTip);
      box.addEventListener("focus", (event) => showCanvasTip(hotspot, event));
      box.addEventListener("blur", hideCanvasTip);

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

  function renderLists() {
    els.hotspotList.innerHTML = "";
    els.selectedSelect.innerHTML = "";

    if (!state.hotspots.length) {
      const empty = document.createElement("p");
      empty.className = "emptyState";
      empty.textContent = "No hotspots yet.";
      els.hotspotList.appendChild(empty);
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
        setMode("select");
      });
      els.hotspotList.appendChild(item);

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

    ["hotTitle", "hotLabel", "hotGuidance", "hotMeta", "hotX", "hotY", "hotW", "hotH"].forEach((id) => {
      els[id].disabled = disabled;
    });

    if (!hotspot) {
      els.hotTitle.value = "";
      els.hotLabel.value = "";
      els.hotGuidance.value = "";
      els.hotMeta.value = "";
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
    if (state.zoom === "actual") {
      state.scale = 1;
    } else {
      const horizontalPadding = 24;
      const verticalPadding = 24;
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
    if (state.zoom === "fit" || previousScale !== state.scale) {
      positionStageForFit(false);
    }
  }

  function positionStageForFit() {
    if (state.zoom !== "fit") return;
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
    const project = getSerializableProject();
    try {
      await dbPut(project);
      state.dirty = false;
      if (showMessage) {
        setStatus("Saved");
      } else {
        setStatus("Autosaved");
      }
      refreshProjects(project.id);
      renderPublicCatalog();
    } catch (err) {
      setStatus("Save failed in this browser");
    }
  }

  async function refreshProjects(selectId) {
    let projects = [];
    try {
      projects = await dbAll();
    } catch (err) {
      setStatus("Saved-project list is unavailable in this browser");
    }
    projects.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    els.projectList.innerHTML = "";
    if (!projects.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No saved projects";
      els.projectList.appendChild(option);
      return;
    }
    projects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = `${project.title || "Untitled"} - ${formatDate(project.updatedAt)}`;
      els.projectList.appendChild(option);
    });
    els.projectList.value = selectId || state.projectId;
  }

  async function loadSelectedProject() {
    const id = els.projectList.value;
    if (!id) return;
    let project = null;
    try {
      project = await dbGet(id);
    } catch (err) {
      setStatus("Could not load saved projects in this browser");
      return;
    }
    if (!project) {
      setStatus("Project was not found");
      return;
    }
    loadProject(project);
    setStatus("Project loaded");
  }

  async function deleteSelectedProject() {
    const id = els.projectList.value;
    if (!id) return;
    if (!window.confirm("Delete the selected saved project from this browser?")) return;
    try {
      await dbDelete(id);
    } catch (err) {
      setStatus("Could not delete that saved project");
      return;
    }
    if (id === state.projectId) {
      newProject();
    }
    refreshProjects();
    renderPublicCatalog();
    setStatus("Project deleted");
  }

  function loadProject(project) {
    Object.assign(state, normalizeProject(project), {
      action: null,
      dirty: false
    });
    els.projectTitle.value = state.title;
    els.imageInput.value = "";
    render();
    applyZoom();
  }

  function getSerializableProject() {
    return {
      id: state.projectId,
      title: state.title,
      image: state.image,
      imageName: state.imageName,
      imageWidth: state.imageWidth,
      imageHeight: state.imageHeight,
      published: Boolean(state.published),
      hotspots: state.hotspots,
      selectedId: state.selectedId,
      createdAt: state.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    };
  }

  function normalizeProject(project) {
    return {
      projectId: project.id || makeId("project"),
      title: project.title || "Untitled training guide",
      image: project.image || "",
      imageName: project.imageName || "",
      imageWidth: Number(project.imageWidth) || 0,
      imageHeight: Number(project.imageHeight) || 0,
      published: Boolean(project.published),
      hotspots: Array.isArray(project.hotspots) ? project.hotspots.map(normalizeHotspot) : [],
      selectedId: project.selectedId || "",
      zoom: "fit",
      scale: 1,
      createdAt: project.createdAt || new Date().toISOString()
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

  function exportProjectJson() {
    downloadFile(`${slugify(state.title)}.project.json`, JSON.stringify(getSerializableProject(), null, 2), "application/json");
  }

  function handleJsonImport(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const project = JSON.parse(reader.result);
        const normalized = normalizeProject(project);
        normalized.projectId = makeId("project");
        loadProject({ ...project, id: normalized.projectId });
        saveProject(true);
      } catch (err) {
        window.alert("That JSON file could not be imported.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function buildTrainingHtml(source) {
    const project = source || getSerializableProject();
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
    * { box-sizing: border-box; }
    body { margin: 0; background: #edf1f5; color: #17202a; font-family: Arial, Helvetica, sans-serif; line-height: 1.45; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 20px; background: linear-gradient(180deg, #ffffff 0%, #f9fbfd 100%); border-bottom: 1px solid #d8dee8; }
    .topbar h1 { margin: 0; font-size: 1.2rem; }
    .topbar p { margin: 2px 0 0; color: #5c6672; font-size: 0.88rem; }
    .main { padding: 18px; }
    .contentShell { max-width: 1600px; margin: 0 auto; }
    .screen { position: relative; width: 100%; background: #fff; border: 1px solid #d8dee8; border-radius: 8px; overflow: hidden; box-shadow: 0 8px 24px rgba(17, 24, 39, 0.08); }
    .screen img { display: block; width: 100%; height: auto; }
    .spot { position: absolute; border: 2px solid rgba(17, 24, 39, 0); background: rgba(255, 200, 87, 0); cursor: help; }
    .spot:hover, .spot:focus, .spot.active { border-color: #111827; background: rgba(255, 200, 87, 0.25); outline: 0; box-shadow: 0 0 0 2px rgba(255,255,255,.92), 0 10px 30px rgba(0,0,0,.16); }
    .spot span { position: absolute; left: -2px; top: -30px; display: none; max-width: min(300px, 82vw); overflow: hidden; border-radius: 5px; background: #111827; color: #fff; padding: 4px 8px; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 700; }
    .spot:hover span, .spot:focus span, .spot.active span { display: block; }
    .tip { position: fixed; z-index: 10; display: none; width: min(360px, calc(100vw - 24px)); border: 1px solid #c8d0dc; border-radius: 8px; background: #fff; padding: 14px; box-shadow: 0 18px 42px rgba(17,24,39,.18); }
    .tip.show { display: block; }
    .tip h2 { margin: 0 0 8px; font-size: 1rem; }
    .tip p { margin: 0; color: #2d3748; white-space: pre-wrap; }
    .tip .meta { margin-top: 10px; color: #5c6672; font-size: .85rem; }
    .empty { padding: 40px 18px; color: #5c6672; text-align: center; }
  </style>
</head>
<body>
  <header class="topbar">
    <div>
      <h1>${safeTitle}</h1>
      <p>Hover or tap a highlighted area for guidance.</p>
    </div>
    <div>${hotspots.length} hotspot${hotspots.length === 1 ? "" : "s"}</div>
  </header>
  <main class="main">
    <div class="contentShell">
      ${image ? `<div class="screen" id="screen"><img src="${image}" alt="${imageAlt}"></div>` : '<p class="empty">This training page has no screenshot yet.</p>'}
      ${image && !hotspots.length ? '<p class="empty">No hotspots were added to this guide.</p>' : ""}
    </div>
  </main>
  <aside class="tip" id="tip" aria-live="polite"></aside>
  <script>
    const hotspots = ${hotspotData};
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
    hotspots.forEach((hotspot) => {
      const spot = document.createElement("button");
      spot.type = "button";
      spot.className = "spot";
      spot.style.left = hotspot.x + "%";
      spot.style.top = hotspot.y + "%";
      spot.style.width = hotspot.w + "%";
      spot.style.height = hotspot.h + "%";
      spot.setAttribute("aria-label", hotspot.title || hotspot.label || "Hotspot");
      const label = document.createElement("span");
      label.textContent = hotspot.label || hotspot.title || "Hotspot";
      spot.appendChild(label);
      spot.addEventListener("mouseenter", (event) => showTip(hotspot, event));
      spot.addEventListener("mousemove", moveTip);
      spot.addEventListener("mouseleave", hideTip);
      spot.addEventListener("focus", (event) => { spot.classList.add("active"); showTip(hotspot, event); });
      spot.addEventListener("blur", hideTip);
      spot.addEventListener("click", (event) => { spot.classList.add("active"); showTip(hotspot, event); });
      screen.appendChild(spot);
    });
    }
  </script>
</body>
</html>`;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbPut(project) {
    try {
      const db = await openDb();
      return await txRequest(db, "readwrite", (store) => store.put(project));
    } catch (err) {
      return localPut(project);
    }
  }

  async function dbGet(id) {
    try {
      const db = await openDb();
      return await txRequest(db, "readonly", (store) => store.get(id));
    } catch (err) {
      return localGet(id);
    }
  }

  async function dbAll() {
    try {
      const db = await openDb();
      return await txRequest(db, "readonly", (store) => store.getAll());
    } catch (err) {
      return localAll();
    }
  }

  async function dbDelete(id) {
    try {
      const db = await openDb();
      return await txRequest(db, "readwrite", (store) => store.delete(id));
    } catch (err) {
      return localDelete(id);
    }
  }

  function txRequest(db, mode, createRequest) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = createRequest(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  function localAll() {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  }

  function localPut(project) {
    const projects = localAll().filter((item) => item.id !== project.id);
    projects.push(project);
    localStorage.setItem(LS_KEY, JSON.stringify(projects));
    return project;
  }

  function localGet(id) {
    return localAll().find((project) => project.id === id);
  }

  function localDelete(id) {
    localStorage.setItem(LS_KEY, JSON.stringify(localAll().filter((project) => project.id !== id)));
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

  function requestEditorMode() {
    if (sessionStorage.getItem(SESSION_KEY) === "1") {
      setViewMode("editor");
      return;
    }
    openEditorModal();
  }

  function openEditorModal() {
    els.editorModal.classList.remove("hidden");
    els.editorPassphrase.value = "";
    els.editorPassphrase.focus();
    els.editorModalText.textContent = localStorage.getItem(PASS_KEY)
      ? "Enter the existing editor passphrase."
      : "No passphrase is set yet. This browser will create one when you unlock.";
  }

  function closeEditorModal() {
    els.editorModal.classList.add("hidden");
  }

  async function submitEditorPassphrase() {
    const passphrase = els.editorPassphrase.value.trim();
    if (!passphrase) return;
    const existing = localStorage.getItem(PASS_KEY);
    const hash = await sha256(passphrase);
    if (existing && existing !== hash) {
      els.editorModalText.textContent = "That passphrase did not match.";
      return;
    }
    if (!existing) {
      localStorage.setItem(PASS_KEY, hash);
    }
    sessionStorage.setItem(SESSION_KEY, "1");
    closeEditorModal();
    setViewMode("editor");
  }

  // ----- Public (user-facing) catalogue -----

  async function renderPublicCatalog() {
    let projects = [];
    try {
      projects = await dbAll();
    } catch (err) {
      projects = [];
    }
    const published = projects
      .filter((project) => project && project.published)
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    els.publicPageList.innerHTML = "";

    if (!published.length) {
      const empty = document.createElement("p");
      empty.className = "emptyState";
      empty.textContent = "No training pages have been published yet.";
      els.publicPageList.appendChild(empty);
      showPublicPage(null);
      return;
    }

    if (!published.some((project) => project.id === state.publicPageId)) {
      state.publicPageId = published[0].id;
    }

    published.forEach((project) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "hotspotItem";
      item.classList.toggle("is-selected", project.id === state.publicPageId);
      item.innerHTML = '<span><strong></strong><span></span></span>';
      item.querySelector("strong").textContent = project.title || "Untitled training page";
      item.querySelector("span span").textContent = `${(project.hotspots || []).length} hotspot${(project.hotspots || []).length === 1 ? "" : "s"}`;
      item.addEventListener("click", () => {
        state.publicPageId = project.id;
        renderPublicCatalog();
      });
      els.publicPageList.appendChild(item);
    });

    showPublicPage(published.find((project) => project.id === state.publicPageId) || published[0]);
  }

  function showPublicPage(project) {
    if (!project) {
      els.publicTitleText.textContent = "No page selected";
      els.publicFrame.srcdoc = "<!doctype html><html><body style=\"margin:0;font-family:Arial,Helvetica,sans-serif;color:#5c6672;display:grid;place-items:center;height:100vh;\"><p>Select a published training page from the list.</p></body></html>";
      return;
    }
    els.publicTitleText.textContent = project.title || "Untitled training page";
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

  function isTyping(target) {
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target && target.tagName);
  }

  async function sha256(value) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
})();
