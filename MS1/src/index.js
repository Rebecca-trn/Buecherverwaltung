const express = require("express");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const yaml = require("yamljs");
const db = require("./db");
const mqtt = require("mqtt");
const createLogger = require("./logging");
const logger = createLogger("ms1");

const app = express();
app.use(express.json());

// --------------------------------------
// CORS
// --------------------------------------
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Accept");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --------------------------------------
// Hilfsfunktionen DEFINIEREN
// --------------------------------------
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

function publishEvent(resource, id, change) {
  const msg = JSON.stringify({ resource, id, change, ts: new Date().toISOString() });
  if (mqttClient && mqttClient.connected) mqttClient.publish("ms1/events", msg);
}

// --------------------------------------
// Hilfsfunktionen
// --------------------------------------
app.locals.getOrCreateIdByName = getOrCreateIdByName;
app.locals.sendError = sendError;
app.locals.publishEvent = publishEvent;

// --------------------------------------
// Controller laden 
// --------------------------------------
const authorController = require("./controllers/author-controller");
const publisherController = require("./controllers/publisher-controller");
const bookController = require("./controllers/book-controller");

// --------------------------------------
// Routes registrieren
// --------------------------------------
app.use("/authors", authorController);
app.use("/publishers", publisherController);
app.use("/books", bookController);

// --------------------------------------
// MQTT + Swagger
// --------------------------------------
const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
let mqttClient = mqtt.connect(MQTT_URL);

let openapiSpec = yaml.load(path.join(__dirname, "..", "openapi.yaml"));
const docsApp = express();
docsApp.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

docsApp.listen(8080, () => {
  logger.info("Swagger UI läuft auf http://localhost:8080/api-docs");
});


// --------------------------------------
// Server starten
// --------------------------------------
app.listen(3000, () => logger.info("API läuft auf http://localhost:3000"));