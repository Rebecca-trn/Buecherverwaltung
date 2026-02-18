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
// CONTROLLER LADEN
// --------------------------------------
const authorController = require("./controllers/author-controller");
const publisherController = require("./controllers/publisher-controller");

// --------------------------------------
// ROUTES REGISTRIEREN
// --------------------------------------
app.use("/authors", authorController);
app.use("/publishers", publisherController);

// --------------------------------------
// CORS für Swagger
// --------------------------------------
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Accept");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --------------------------------------
// MQTT
// --------------------------------------
const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
const MQTT_TOPIC = "ms1/events";

let mqttClient;
try {
  mqttClient = mqtt.connect(MQTT_URL);
  mqttClient.on("connect", () => logger.info("MQTT connected:", MQTT_URL));
  mqttClient.on("error", err => logger.info("MQTT error:", err.message));
} catch (e) {
  logger.info("MQTT connect failed:", e.message);
}

function publishEvent(resource, id, change) {
  const msg = JSON.stringify({
    resource,
    id,
    change,
    ts: new Date().toISOString(),
  });

  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(MQTT_TOPIC, msg, { qos: 0 }, (err) => {
      if (err) {
        logger.error(`MQTT publish error: ${err.message}`);
      } else {
        logger.info(`MQTT Event gesendet: ${msg}`);
      }
    });
  } else {
    logger.warn(`MQTT nicht verbunden – Event übersprungen: ${msg}`);
  }
}

// publishEvent für Controller verfügbar machen
app.locals.publishEvent = publishEvent;

// --------------------------------------
// Hilfsfunktionen
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

// --------------------------------------
// SWAGGER
// --------------------------------------
let openapiSpec;
try {
  const openapiPath = path.join(__dirname, "..", "openapi.yaml");
  openapiSpec = yaml.load(openapiPath);
  logger.info("OpenAPI geladen:", openapiSpec.openapi, "-", openapiSpec.info?.title);
} catch (e) {
  logger.info("Fehler beim Laden der OpenAPI-Datei:", e.message);
  openapiSpec = { openapi: "3.0.3", info: { title: "Fallback Spec", version: "1.0.0" }, paths: {} };
}

const docsApp = express();
docsApp.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
docsApp.listen(8080, () => {
  logger.info("Swagger-UI läuft auf http://localhost:8080/api-docs");
});

// --------------------------------------
// BOOK ROUTES 
// --------------------------------------

app.get("/books", (req, res) => {
  const q = (req.query.q || "").trim();

  const baseSql = `
    SELECT b.id, b.title,
           a.name AS author,
           p.name AS publisher
    FROM books b
    JOIN authors a    ON a.id = b.author_id
    JOIN publishers p ON p.id = b.publisher_id
  `;

  if (!q) {
    db.all(baseSql + " ORDER BY b.id", [], (err, rows) => {
      if (err) return sendError(res, 500, err.message);
      res.json(rows);
    });
  } else {
    const like = `%${q}%`;
    db.all(
      baseSql + `
        WHERE LOWER(b.title) LIKE LOWER(?)
           OR LOWER(a.name)  LIKE LOWER(?)
           OR LOWER(p.name)  LIKE LOWER(?)
        ORDER BY b.id
      `,
      [like, like, like],
      (err, rows) => {
        if (err) return sendError(res, 500, err.message);
        res.json(rows);
      }
    );
  }
});

// GET /books/:id
app.get("/books/:id", (req, res) => {
  db.get(
    `
    SELECT b.id, b.title,
           a.name AS author,
           p.name AS publisher
    FROM books b
    JOIN authors a    ON a.id = b.author_id
    JOIN publishers p ON p.id = b.publisher_id
    WHERE b.id = ?
    `,
    [req.params.id],
    (err, row) => {
      if (err) return sendError(res, 500, err.message);
      if (!row) return sendError(res, 404, "Buch nicht gefunden");
      res.json(row);
    }
  );
});

// POST /books
app.post("/books", (req, res) => {
  const { title, author, publisher } = req.body;
  if (!title || !author || !publisher) {
    return sendError(res, 400, "title, author, publisher sind Pflichtfelder");
  }

  getOrCreateIdByName("authors", author, (eA, author_id) => {
    if (eA) return sendError(res, 500, eA.message);

    getOrCreateIdByName("publishers", publisher, (eP, publisher_id) => {
      if (eP) return sendError(res, 500, eP.message);

      db.run(
        "INSERT INTO books (title, author_id, publisher_id) VALUES (?,?,?)",
        [title, author_id, publisher_id],
        function (err) {
          if (err) return sendError(res, 500, err.message);

          db.get(
            `SELECT b.id, b.title, a.name AS author, p.name AS publisher
             FROM books b
             JOIN authors a ON a.id = b.author_id
             JOIN publishers p ON p.id = b.publisher_id
             WHERE b.id = ?`,
            [this.lastID],
            (err2, row) => {
              if (err2) return sendError(res, 500, err2.message);
              publishEvent("books", row.id, "created");
              res.status(201).json(row);
            }
          );
        }
      );
    });
  });
});

// PATCH /books/:id
app.patch("/books/:id", (req, res) => {
  const allowed = ["title", "author", "publisher"];
  const body = {};
  for (const k of allowed)
    if (Object.prototype.hasOwnProperty.call(req.body, k)) body[k] = req.body[k];

  if (Object.keys(body).length === 0)
    return sendError(res, 400, "Keine gültigen Felder zum Aktualisieren");

  const doUpdate = (fields) => {
    const sets = [];
    const params = [];

    if (fields.title) { sets.push("title = ?"); params.push(fields.title); }
    if (fields.author_id) { sets.push("author_id = ?"); params.push(fields.author_id); }
    if (fields.publisher_id) { sets.push("publisher_id = ?"); params.push(fields.publisher_id); }

    params.push(req.params.id);

    db.run(`UPDATE books SET ${sets.join(", ")} WHERE id = ?`, params, function (err) {
      if (err) return sendError(res, 500, err.message);
      if (this.changes === 0) return sendError(res, 404, "Buch nicht gefunden");

      db.get(
        `SELECT b.id, b.title, a.name AS author, p.name AS publisher
         FROM books b
         JOIN authors a ON a.id = b.author_id
         JOIN publishers p ON p.id = b.publisher_id
         WHERE b.id = ?`,
        [req.params.id],
        (err2, row) => {
          if (err2) return sendError(res, 500, err2.message);
          publishEvent("books", row.id, "updated");
          res.json(row);
        }
      );
    });
  };

  const out = { title: body.title };

  const nextForPublisher = () => {
    if (!body.publisher) return doUpdate(out);
    getOrCreateIdByName("publishers", body.publisher, (eP, pid) => {
      if (eP) return sendError(res, 500, eP.message);
      out.publisher_id = pid;
      doUpdate(out);
    });
  };

  if (!body.author) return nextForPublisher();

  getOrCreateIdByName("authors", body.author, (eA, aid) => {
    if (eA) return sendError(res, 500, eA.message);
    out.author_id = aid;
    nextForPublisher();
  });
});

// DELETE /books/:id
app.delete("/books/:id", (req, res) => {
  db.run("DELETE FROM books WHERE id = ?", [req.params.id], function (err) {
    if (err) return sendError(res, 500, err.message);
    if (this.changes === 0) return sendError(res, 404, "Buch nicht gefunden");

    publishEvent("books", Number(req.params.id), "deleted");
    res.status(204).send();
  });
});

// --------------------------------------
// SERVER STARTEN
// --------------------------------------
app.listen(3000, () => {
  logger.info("API läuft auf http://localhost:3000");
});