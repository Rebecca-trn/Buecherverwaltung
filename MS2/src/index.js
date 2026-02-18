const mqtt = require("mqtt");

// Konfiguration
const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
const MQTT_TOPIC = process.env.MQTT_TOPIC || "ms1/events";
const clientId = "ms2-" + Math.random().toString(16).slice(2);

// MQTT verbinden (automatischer Reconnect)
const client = mqtt.connect(MQTT_URL, {
  clientId,
  reconnectPeriod: 2000,
});

client.on("connect", () => {
  console.log(`[MS2] Verbunden mit ${MQTT_URL}. Abonniere "${MQTT_TOPIC}" …`);
  client.subscribe(MQTT_TOPIC, { qos: 0 }, (err) => {
    if (err) {
      console.error("[MS2] Subscribe-Fehler:", err.message);
    } else {
      console.log(`[MS2] Abonniert: ${MQTT_TOPIC}`);
    }
  });
});

client.on("reconnect", () => console.log("[MS2] Reconnect …"));
client.on("close", () => console.log("[MS2] Verbindung geschlossen"));
client.on("error", (err) => console.error("[MS2] MQTT-Fehler:", err.message));

// Helfer: hübsche Texte
function toNiceText(msg) {
  const names = { books: "Buch", authors: "Autor", publishers: "Verlag" };
  const res = names[msg.resource] || (msg.resource || "Ressource");
  const action =
    msg.change === "created" ? "angelegt" :
    msg.change === "updated" ? "aktualisiert" :
    msg.change === "deleted" ? "gelöscht"   : (msg.change || "geändert");
  const when = msg.ts ? new Date(msg.ts) : new Date();
  const whenStr = when.toLocaleString();
  const id = msg.id ?? "?";
  return `[${whenStr}] ${res} #${id} wurde ${action}.`;
}

// Nachrichten empfangen
client.on("message", (topic, payload) => {
  try {
    const text = payload.toString("utf8");
    const msg = JSON.parse(text);

    if (!msg || typeof msg !== "object") {
      console.log("[MS2] Unbekanntes Format:", text);
      return;
    }
    console.log("[MS2]", toNiceText(msg));
  } catch (e) {
    console.log("[MS2] Konnte Nachricht nicht parsen:", payload.toString());
  }
});

// Sauber beenden
process.on("SIGINT", () => {
  console.log("\n[MS2] Beende …");
  client.end(true, () => process.exit(0));
});