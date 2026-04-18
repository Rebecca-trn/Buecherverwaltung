const express = require("express");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const yaml = require("yamljs");
const db = require("./db");
const mqtt = require("mqtt");
const createLogger = require("./logging");
const logger = createLogger("ms1");
const mqttchannel="rebecca-ms1/events";
logger.setLevel("debug");
logger.info(`Welcome at Rebecca's Version of MS1 Module`);

// MQTT-Client VOR app-Setup initialisieren
const MQTT_URL = process.env.MQTT_URL || "wss://mqtt.zimolong.eu/";
let mqttClient = mqtt.connect(MQTT_URL, {
  username: process.env.MQTT_USERNAME || "dhbw",
  password: process.env.MQTT_PASSWORD || "dhbw"
});

// Warte auf MQTT-Verbindung
mqttClient.on("connect", () => {
  logger.info("MQTT-Client verbunden " + MQTT_URL+ " MQTT_USERNAME dhbw ");
  logger.info("MQTT-channel: " + mqttchannel);
  db.setMqttReady();
});

mqttClient.on("error", (err) => {
  logger.error("MQTT-Fehler:", err.message);
});

// publishEvent-Funktion definieren
function publishEvent(resource, id, change) {
  const msg = JSON.stringify({ resource, id, change, ts: new Date().toISOString() });
  if (mqttClient && mqttClient.connected) mqttClient.publish(mqttchannel, msg);
  else logger.warn("MQTT-Client nicht verbunden, Event nicht gesendet:", msg);
}

// Callback SOFORT nach MQTT-Client registrieren
db.setPublishEventCallback(publishEvent);

const app = express();
app.use((req, res, next) => {
  logger.info(`HTTP ${req.method} ${req.originalUrl} -- start`);
  logger.debug(`Headers: ${JSON.stringify(req.headers)}`);
  if (req.method !== "GET") {
    logger.debug(`Body: ${JSON.stringify(req.body)}`);
  }
  res.on("finish", () => {
    logger.info(`HTTP ${req.method} ${req.originalUrl} -- done (${res.statusCode})`);
  });
  next();
});
app.use(express.json());

app.locals.logger = logger;

// CORS 

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Accept");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Hilfsfunktionen

function getOrCreateIdByName(table, name, cb) {
  if (!name) return cb(new Error("name required"));
  db.get(`SELECT id FROM ${table} WHERE name = ?`, [name], (e, row) => {
    if (e) return cb(e);
    if (row) return cb(null, row.id);

    db.run(`INSERT INTO ${table} (name) VALUES (?)`, [name], function (e2) {
      if (e2) return cb(e2);
      cb(null, this.lastID);
    });
  });
}

function sendError(res, statusCode, msg) {
  res.setHeader("X-Fehlermeldung", msg);
  return res.status(statusCode).json({ error: msg });
}


app.locals.getOrCreateIdByName = getOrCreateIdByName;
app.locals.sendError = sendError;
app.locals.publishEvent = publishEvent;

// Controller laden

const authorController = require("./controllers/author-controller");
const publisherController = require("./controllers/publisher-controller");
const bookController = require("./controllers/book-controller");

// Routen

app.use("/authors", authorController);
app.use("/publishers", publisherController);
app.use("/books", bookController);

// Verbindungsbestätigung nach Start
mqttClient.publish(mqttchannel, JSON.stringify({
  resource: "ms1",
  id: null,
  change: "connected",
  message: "Rebecca's MQTT-Client ist verbunden und sendet Events!",
  ts: new Date().toISOString()
}));

let openapiSpec = yaml.load(path.join(__dirname, "..", "openapi.yaml"));
const docsApp = express();
docsApp.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

docsApp.listen(8080, () => {
  logger.info("Swagger UI läuft auf http://localhost:8080/api-docs");
});


// Server starten

app.listen(8000, () => logger.info("API läuft auf http://localhost:8000"));