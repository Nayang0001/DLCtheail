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
  startTracking: document.querySelector("#startTracking"),
  stopTracking: document.querySelector("#stopTracking"),
  trackingBadge: document.querySelector("#trackingBadge"),
  trackingStatus: document.querySelector("#trackingStatus"),
  error: document.querySelector("#errorMessage"),
  connectionDot: document.querySelector("#connectionDot"),
  connectionLabel: document.querySelector("#connectionLabel"),
  members: document.querySelector("#members"),
  memberCount: document.querySelector("#memberCount")
};

const statLabels = [
  ["health", "Salud"],
  ["stamina", "Estamina"],
  ["hunger", "Hambre"],
  ["water", "Agua"],
  ["growth", "Crecimiento"]
];
const { DEFAULT_RELAY_URL, normalizeRelayUrl } = window.CompanionConfig;

let socket = null;
let trackingTimer = null;
let reading = false;
let readingLocalData = false;
let profile = null;
let lastStats = null;
let lastSampleAgeMs = 0;
let lastSampleReadAt = 0;
let lastSourceVersion = null;
let roomCode = null;
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
      setConnection(false, reading ? "Lectura activa · desconectado" : "Desconectado");
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
    if (lastStats) {
      const currentAge = lastSampleAgeMs + Date.now() - lastSampleReadAt;
      if (currentAge <= 180_000) sendStats(lastStats, Math.round(currentAge));
    }
    return;
  }
  if (message.type === "player:update") {
    members.set(message.profile.steamId, {
      profile: message.profile,
      stats: message.stats,
      updatedAt: message.updatedAt,
      sourceUpdatedAt: message.sourceUpdatedAt
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
    elements.roomCard.classList.add("hidden");
    setConnection(false, "Desconectado");
    return;
  }
  if (message.type === "error") {
    showError(message.message || "El relay rechazó la solicitud.");
    if (!roomCode && socket && socket.readyState === WebSocket.OPEN) socket.close();
    return;
  }
  console.warn("Unrecognized relay message:", message.type);
}

function sendStats(stats, sourceAgeMs) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !roomCode) return;
  socket.send(JSON.stringify({ type: "player:update", stats, sourceAgeMs: Math.round(sourceAgeMs) }));
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
    waiting.textContent = "Esperando la primera lectura local de Evrima…";
    card.append(waiting);
    return card;
  }

  const dino = document.createElement("div");
  dino.className = "dino-line";
  const species = document.createElement("strong");
  species.textContent = member.stats.species;
  const prime = document.createElement("span");
  prime.className = `prime-badge${member.stats.prime === true ? "" : " not-prime"}`;
  prime.textContent = member.stats.prime === null ? "N/D" : member.stats.prime ? "PRIME" : "NO PRIME";
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
    const statValue = member.stats[key];
    value.textContent = statValue === null ? "N/D" : `${Number(statValue.toFixed(2))}%`;
    line.append(title, value);
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    fill.style.width = statValue === null ? "0%" : `${statValue}%`;
    bar.append(fill);
    item.append(line, bar);
    if (statValue === null) item.classList.add("stat-unavailable");
    stats.append(item);
  }
  card.append(stats);

  const mutationLine = document.createElement("div");
  mutationLine.className = "mutations";
  const mutationTitle = document.createElement("strong");
  mutationTitle.textContent = "Mutaciones: ";
  const mutationText = member.stats.mutations === null
    ? "No disponibles en los datos locales"
    : member.stats.mutations.join(", ") || "Ninguna";
  mutationLine.append(mutationTitle, document.createTextNode(mutationText));
  card.append(mutationLine);

  const updated = document.createElement("div");
  updated.className = "updated";
  if (Number.isInteger(member.sourceUpdatedAt)) {
    const age = Math.max(0, Math.round((Date.now() - member.sourceUpdatedAt) / 1000));
    updated.textContent = age < 2 ? "Lectura local: ahora" : `Lectura local: hace ${age}s`;
  } else {
    updated.textContent = "Esperando lectura local";
  }
  card.append(updated);
  return card;
}

async function readLocalDinosaur() {
  if (!reading || readingLocalData) return;
  readingLocalData = true;
  try {
    const snapshot = await window.companion.readLocalDinosaur();
    if (!snapshot.available) {
      elements.trackingStatus.textContent = snapshot.reason === "game-data-folder-missing"
        ? "No encuentro los datos locales de Evrima. Comprueba que el juego esté instalado para este usuario."
        : "Esperando TempData reciente. Entra a un servidor y carga tu dinosaurio.";
      return;
    }

    lastStats = snapshot.stats;
    lastSampleAgeMs = snapshot.ageMs;
    lastSampleReadAt = Date.now();
    const ageSeconds = Math.round(snapshot.ageMs / 1000);
    const sharing = socket?.readyState === WebSocket.OPEN && roomCode;
    elements.trackingStatus.textContent =
      `${snapshot.stats.species} · lectura local de hace ${ageSeconds}s · ${sharing ? "compartiendo" : "esperando sala"}`;

    if (snapshot.version !== lastSourceVersion) {
      lastSourceVersion = snapshot.version;
      sendStats(snapshot.stats, snapshot.ageMs);
    }
  } catch (error) {
    console.error("Could not read Evrima local character data:", error);
    elements.trackingStatus.textContent = "No se pudo leer TempData; se volverá a intentar.";
    showError(`Falló la lectura local de Evrima: ${error.message}`);
  } finally {
    readingLocalData = false;
  }
}

async function startTracking() {
  if (reading) return;
  clearError();
  reading = true;
  elements.startTracking.disabled = true;
  elements.stopTracking.disabled = false;
  elements.trackingBadge.textContent = "LEYENDO TEMPDATA";
  elements.trackingBadge.classList.add("active");
  elements.trackingStatus.textContent = "Buscando la lectura local más reciente de Evrima…";
  await readLocalDinosaur();
  if (reading) trackingTimer = window.setInterval(readLocalDinosaur, 2500);
}

function stopTracking() {
  reading = false;
  if (trackingTimer) window.clearInterval(trackingTimer);
  trackingTimer = null;
  elements.startTracking.disabled = false;
  elements.stopTracking.disabled = true;
  elements.trackingBadge.textContent = "DETENIDO";
  elements.trackingBadge.classList.remove("active");
  elements.trackingStatus.textContent = "Seguimiento detenido; no se comparten nuevas lecturas.";
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
elements.startTracking.addEventListener("click", startTracking);
elements.stopTracking.addEventListener("click", stopTracking);

loadSettings();
renderMembers();
