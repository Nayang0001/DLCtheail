const elements = {
  name: document.querySelector("#playerName"),
  steamId: document.querySelector("#steamId"),
  relayUrl: document.querySelector("#relayUrl"),
  codeInput: document.querySelector("#roomCodeInput"),
  createRoom: document.querySelector("#createRoom"),
  joinRoom: document.querySelector("#joinRoom"),
  roomCard: document.querySelector("#roomCard"),
  roomCode: document.querySelector("#roomCode"),
  copyRoomCode: document.querySelector("#copyRoomCode"),
  screenSource: document.querySelector("#screenSource"),
  refreshSources: document.querySelector("#refreshSources"),
  startCapture: document.querySelector("#startCapture"),
  stopCapture: document.querySelector("#stopCapture"),
  preview: document.querySelector("#screenPreview"),
  previewPlaceholder: document.querySelector("#previewPlaceholder"),
  captureBadge: document.querySelector("#captureBadge"),
  captureStatus: document.querySelector("#captureStatus"),
  error: document.querySelector("#errorMessage"),
  connectionDot: document.querySelector("#connectionDot"),
  connectionLabel: document.querySelector("#connectionLabel"),
  members: document.querySelector("#members"),
  memberCount: document.querySelector("#memberCount")
};
const { isComplete, measureHudBars, parseHudLines, statLabels } = window.HudParser;
const { DEFAULT_RELAY_URL, normalizeRelayUrl } = window.CompanionConfig;

let socket = null;
let worker = null;
let captureTimer = null;
let reading = false;
let processingCapture = false;
let profile = null;
let lastStats = null;
let roomCode = null;
let joinIntent = null;
const members = new Map();

function showError(message) {
  elements.error.textContent = message;
  elements.error.classList.remove("hidden");
}

function clearError() {
  elements.error.textContent = "";
  elements.error.classList.add("hidden");
}

function setConnection(connected, label) {
  elements.connectionLabel.textContent = label;
  elements.connectionDot.parentElement.classList.toggle("connected", connected);
}

function saveSettings() {
  localStorage.setItem("pack-companion-settings", JSON.stringify({
    name: elements.name.value.trim(),
    steamId: elements.steamId.value.trim(),
    relayUrl: elements.relayUrl.value.trim()
  }));
}

function loadSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem("pack-companion-settings") || "{}");
    elements.name.value = settings.name || "";
    elements.steamId.value = settings.steamId || "";
    elements.relayUrl.value = normalizeRelayUrl(settings.relayUrl);
    saveSettings();
  } catch (error) {
    console.error("Could not load saved settings:", error);
    elements.relayUrl.value = DEFAULT_RELAY_URL;
  }
}

function getProfile() {
  const name = elements.name.value.trim();
  const steamId = elements.steamId.value.trim();
  if (!name) throw new Error("Escribe el nombre que verán tus amigos.");
  if (!/^\d{17}$/.test(steamId)) throw new Error("El SteamID64 debe tener 17 dígitos.");
  return { name: name.slice(0, 32), steamId };
}

function getRelayUrl() {
  let url;
  try {
    url = new URL(elements.relayUrl.value.trim());
  } catch {
    throw new Error("Escribe la dirección WebSocket de tu relay.");
  }
  if (!["ws:", "wss:"].includes(url.protocol)) {
    throw new Error("El relay debe empezar por ws:// o wss://.");
  }
  return url.toString();
}

function connectToRoom(intent, code = "") {
  clearError();
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    showError("Ya hay una conexión activa. Sal de esa sala antes de conectarte a otra.");
    return;
  }
  try {
    profile = getProfile();
    const url = getRelayUrl();
    saveSettings();
    joinIntent = { intent, code };
    const nextSocket = new WebSocket(url);
    socket = nextSocket;
    setConnection(false, "Conectando…");
    nextSocket.addEventListener("open", () => {
      nextSocket.send(JSON.stringify({
        type: intent === "create" ? "room:create" : "room:join",
        profile,
        ...(intent === "join" ? { roomCode: code } : {})
      }));
    });
    nextSocket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        console.error("Relay sent invalid JSON:", error);
        showError("El relay envió una respuesta inválida.");
        return;
      }
      handleRelayMessage(message);
    });
    nextSocket.addEventListener("error", () => {
      showError("No se pudo conectar al relay. Comprueba la URL y que el servidor esté activo.");
    });
    nextSocket.addEventListener("close", () => {
      socket = null;
      roomCode = null;
      members.clear();
      renderMembers();
      elements.roomCard.classList.add("hidden");
      setConnection(false, "Desconectado");
      if (reading) setConnection(false, "Lectura activa · desconectado");
    });
  } catch (error) {
    showError(error.message);
  }
}

function handleRelayMessage(message) {
  if (message.type === "room:joined") {
    roomCode = message.roomCode;
    elements.roomCode.textContent = roomCode;
    elements.roomCard.classList.remove("hidden");
    setConnection(true, `Sala ${roomCode}`);
    for (const member of message.members || []) {
      members.set(member.profile.steamId, member);
    }
    renderMembers();
    if (lastStats) sendStats(lastStats);
    return;
  }
  if (message.type === "player:update") {
    members.set(message.profile.steamId, {
      profile: message.profile,
      stats: message.stats,
      updatedAt: message.updatedAt
    });
    renderMembers();
    return;
  }
  if (message.type === "player:joined") {
    members.set(message.profile.steamId, { profile: message.profile, stats: null, updatedAt: null });
    renderMembers();
    return;
  }
  if (message.type === "player:left") {
    members.delete(message.steamId);
    renderMembers();
    return;
  }
  if (message.type === "room:left") {
    roomCode = null;
    members.clear();
    renderMembers();
    return;
  }
  if (message.type === "error") {
    showError(message.message || "El relay rechazó la solicitud.");
    if (!roomCode && socket && socket.readyState === WebSocket.OPEN) socket.close();
    return;
  }
  console.warn("Unrecognized relay message:", message.type);
}

function sendStats(stats) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !roomCode) return;
  socket.send(JSON.stringify({ type: "player:update", stats }));
}

function renderMembers() {
  const sorted = Array.from(members.values()).sort((left, right) =>
    left.profile.name.localeCompare(right.profile.name)
  );
  elements.memberCount.textContent = String(sorted.length);
  elements.members.replaceChildren();

  if (sorted.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<span>◌</span><p>Crea una sala o únete con un código.<br>Las fichas de tu manada aparecerán aquí.</p>";
    elements.members.append(empty);
    return;
  }

  for (const member of sorted) elements.members.append(createMemberCard(member));
}

function createMemberCard(member) {
  const card = document.createElement("article");
  card.className = "member-card";
  const header = document.createElement("div");
  header.className = "member-header";
  const identity = document.createElement("div");
  const name = document.createElement("div");
  name.className = "member-name";
  name.textContent = member.profile.name;
  const id = document.createElement("div");
  id.className = "member-id";
  id.textContent = member.profile.steamId;
  identity.append(name, id);
  const online = document.createElement("span");
  online.className = "member-online";
  online.textContent = "EN LÍNEA";
  header.append(identity, online);
  card.append(header);

  if (!member.stats) {
    const waiting = document.createElement("p");
    waiting.className = "hint";
    waiting.textContent = "Esperando la primera lectura del HUD…";
    card.append(waiting);
    return card;
  }

  const dino = document.createElement("div");
  dino.className = "dino-line";
  const species = document.createElement("strong");
  species.textContent = member.stats.species;
  const prime = document.createElement("span");
  prime.className = `prime-badge${member.stats.prime ? "" : " not-prime"}`;
  prime.textContent = member.stats.prime ? "PRIME" : "NO PRIME";
  dino.append(species, prime);
  card.append(dino);

  const stats = document.createElement("div");
  stats.className = "stats-grid";
  for (const [key, label] of statLabels) {
    const item = document.createElement("div");
    item.className = "stat";
    const line = document.createElement("div");
    line.className = "stat-label";
    const title = document.createElement("span");
    title.textContent = label;
    const value = document.createElement("b");
    value.textContent = `${Math.round(member.stats[key])}%`;
    line.append(title, value);
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    fill.style.width = `${member.stats[key]}%`;
    bar.append(fill);
    item.append(line, bar);
    stats.append(item);
  }
  card.append(stats);

  const mutationLine = document.createElement("div");
  mutationLine.className = "mutations";
  const mutationTitle = document.createElement("strong");
  mutationTitle.textContent = "Mutaciones: ";
  mutationLine.append(mutationTitle, document.createTextNode(member.stats.mutations.join(", ") || "Ninguna detectada"));
  card.append(mutationLine);

  const updated = document.createElement("div");
  updated.className = "updated";
  const age = Math.max(0, Math.round((Date.now() - member.updatedAt) / 1000));
  updated.textContent = age < 2 ? "Actualizado ahora" : `Actualizado hace ${age}s`;
  card.append(updated);
  return card;
}

function readOcrLayout(data, scale = 1) {
  const lines = [];
  const words = [];
  const scaleBox = (bbox) => bbox ? ({
    x0: bbox.x0 / scale,
    y0: bbox.y0 / scale,
    x1: bbox.x1 / scale,
    y1: bbox.y1 / scale
  }) : null;
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        lines.push({ text: line.text, bbox: scaleBox(line.bbox) });
        words.push(...(line.words || []).map((word) => ({
          ...word,
          bbox: scaleBox(word.bbox)
        })));
      }
    }
  }
  return {
    lines: lines.length ? lines : data.text.split(/\r?\n/).filter(Boolean),
    words
  };
}

async function prepareOcrImage(screenshot, scale = 2) {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("No se pudo preparar la captura para OCR."));
    image.src = screenshot;
  });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth * scale;
  canvas.height = image.naturalHeight * scale;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No se pudo crear el lienzo local para el OCR.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    dataUrl: canvas.toDataURL("image/png"),
    pixels: context.getImageData(0, 0, image.naturalWidth, image.naturalHeight),
    width: image.naturalWidth,
    height: image.naturalHeight
  };
}

async function loadScreenSources() {
  clearError();
  try {
    const sources = await window.companion.listScreenSources();
    const previous = elements.screenSource.value;
    elements.screenSource.replaceChildren();
    for (const source of sources) {
      const option = document.createElement("option");
      option.value = source.id;
      option.textContent = source.name.slice(0, 90);
      elements.screenSource.append(option);
    }
    if (sources.some((source) => source.id === previous)) elements.screenSource.value = previous;
    elements.startCapture.disabled = sources.length === 0 || reading;
    elements.captureStatus.textContent = sources.length
      ? "Elige la ventana que muestra el panel activo de tu dinosaurio."
      : "No se encontraron ventanas o pantallas disponibles.";
  } catch (error) {
    showError(`No se pudieron enumerar las ventanas: ${error.message}`);
  }
}

function getWorker() {
  if (!worker) {
    worker = Tesseract.createWorker("eng+spa", 1, {
      workerPath: new URL("../../node_modules/tesseract.js/dist/worker.min.js", location.href).href,
      corePath: new URL("../../node_modules/tesseract.js-core", location.href).href,
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: (event) => {
        if (event.status === "recognizing text") {
          elements.captureStatus.textContent = `Leyendo HUD… ${Math.round(event.progress * 100)}%`;
        } else if (event.status === "loading language traineddata") {
          elements.captureStatus.textContent = "Descargando datos de OCR (solo la primera vez)…";
        }
      }
    });
  }
  return worker;
}

async function readHud() {
  if (!reading || processingCapture || !elements.screenSource.value) return;
  processingCapture = true;
  try {
    const screenshot = await window.companion.captureScreenSource(elements.screenSource.value);
    elements.preview.src = screenshot;
    elements.previewPlaceholder.classList.add("hidden");
    const prepared = await prepareOcrImage(screenshot);
    const ocr = await getWorker();
    const result = await ocr.recognize(prepared.dataUrl, {}, { blocks: true });
    const layout = readOcrLayout(result.data, 2);
    const stats = parseHudLines(layout.lines, layout.words, {
      leftPanelWidth: prepared.width * 0.18,
      mutationMaxHeight: prepared.height * 0.8
    });
    const barStats = measureHudBars(prepared.pixels.data, prepared.width, prepared.height, layout.words);
    for (const [key] of statLabels) {
      if (stats[key] === null) stats[key] = barStats[key];
    }
    lastStats = stats;

    const missing = statLabels.filter(([key]) => stats[key] === null).map(([, label]) => label);
    if (!stats.species) missing.unshift("dinosaurio");
    if (!isComplete(stats)) {
      elements.captureStatus.textContent = `Esperando lectura completa: ${missing.join(", ")}. Mantén el panel del dino visible.`;
      return;
    }
    const sharing = socket?.readyState === WebSocket.OPEN && roomCode;
    elements.captureStatus.textContent = `Detectado ${stats.species}${stats.prime ? " · Prime" : ""} · ${sharing ? "compartiendo" : "esperando sala"}`;
    sendStats(stats);
    const ownMember = members.get(profile?.steamId);
    if (ownMember) {
      ownMember.stats = stats;
      ownMember.updatedAt = Date.now();
      renderMembers();
    }
  } catch (error) {
    console.error("HUD capture/OCR failed:", error);
    elements.captureStatus.textContent = "Falló la captura o el OCR. Revisa permisos y conexión a Internet para descargar el modelo.";
    showError(`No se pudo leer la ventana seleccionada: ${error.message}`);
  } finally {
    processingCapture = false;
  }
}

async function startCapture() {
  if (reading) return;
  if (!elements.screenSource.value) {
    showError("Selecciona primero una ventana o pantalla.");
    return;
  }
  clearError();
  reading = true;
  elements.startCapture.disabled = true;
  elements.stopCapture.disabled = false;
  elements.captureBadge.textContent = "LEYENDO";
  elements.captureBadge.classList.add("active");
  elements.captureStatus.textContent = "Preparando OCR local…";
  await readHud();
  if (reading) captureTimer = window.setInterval(readHud, 3500);
}

async function stopCapture() {
  reading = false;
  if (captureTimer) window.clearInterval(captureTimer);
  captureTimer = null;
  elements.startCapture.disabled = !elements.screenSource.value;
  elements.stopCapture.disabled = true;
  elements.captureBadge.textContent = "DETENIDO";
  elements.captureBadge.classList.remove("active");
  elements.captureStatus.textContent = "Lectura detenida. No se están compartiendo nuevas actualizaciones.";
}

elements.name.addEventListener("change", saveSettings);
elements.steamId.addEventListener("change", saveSettings);
elements.relayUrl.addEventListener("change", saveSettings);
elements.createRoom.addEventListener("click", () => connectToRoom("create"));
elements.joinRoom.addEventListener("click", () => {
  const code = elements.codeInput.value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    showError("El código de sala debe tener seis caracteres.");
    return;
  }
  connectToRoom("join", code);
});
elements.codeInput.addEventListener("input", () => {
  elements.codeInput.value = elements.codeInput.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "");
});
elements.copyRoomCode.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode || "");
    elements.copyRoomCode.textContent = "COPIADO";
    window.setTimeout(() => { elements.copyRoomCode.textContent = "COPIAR"; }, 1200);
  } catch (error) {
    showError(`No se pudo copiar el código: ${error.message}`);
  }
});
elements.refreshSources.addEventListener("click", loadScreenSources);
elements.screenSource.addEventListener("change", () => {
  elements.startCapture.disabled = !elements.screenSource.value || reading;
  elements.preview.src = "";
  elements.previewPlaceholder.classList.remove("hidden");
});
elements.startCapture.addEventListener("click", startCapture);
elements.stopCapture.addEventListener("click", stopCapture);

loadSettings();
renderMembers();
loadScreenSources();
