const express = require("express");
const router = express.Router();
const db = require("../db");

// get publishers
router.get("/", (req, res) => {
  const { sendError, logger } = req.app.locals;
  const q = (req.query.q || "").trim();
  logger.debug(`[publisher-controller] GET / q=${q}`);

  if (!q) {
    db.all(
      "SELECT id, name, city FROM publishers ORDER BY id",
      [],
      (err, rows) => {
        if (err) {
          logger.error(`[publisher-controller] GET / failed: ${err.message}`);
          return sendError(res, 500, err.message);
        }
        logger.debug(`[publisher-controller] GET / returned ${rows.length} rows`);
        res.json(rows);
      }
    );
  } else {
    const like = `%${q}%`;
    db.all(
      `SELECT id, name, city
         FROM publishers
        WHERE LOWER(name) LIKE LOWER(?)
           OR LOWER(COALESCE(city,'')) LIKE LOWER(?)
        ORDER BY id`,
      [like, like],
      (err, rows) => {
        if (err) {
          logger.error(`[publisher-controller] GET / q=${q} failed: ${err.message}`);
          return sendError(res, 500, err.message);
        }
        logger.debug(`[publisher-controller] GET / q=${q} returned ${rows.length} rows`);
        res.json(rows);
      }
    );
  }
});

//get publisher by id
router.get("/:id", (req, res) => {
  const { sendError, logger } = req.app.locals;
  const { id } = req.params;
  logger.debug(`[publisher-controller] GET /${id}`);


  db.get(
    "SELECT id, name, city FROM publishers WHERE id = ?",
    [req.params.id],
    (err, row) => {
      if (err) {
        logger.error(`[publisher-controller] GET /${id} failed: ${err.message}`);
        return sendError(res, 500, err.message);
      }
      if (!row) {
        logger.warn(`[publisher-controller] GET /${id} not found`);
        return sendError(res, 404, "Verlag nicht gefunden");
      }
      logger.info(`[publisher-controller] GET /${id} success`);
      res.json(row);
    }
  );
});

// post publisher
router.post("/", (req, res) => {
  const { sendError, publishEvent, logger } = req.app.locals;
  const { name, city } = req.body;
  logger.debug(`[publisher-controller] POST / body=${JSON.stringify(req.body)}`);


  if (!name) {
    logger.warn("[publisher-controller] POST / missing name");
    return sendError(res, 400, "name fehlt");
  }

  db.run(
    "INSERT INTO publishers (name, city) VALUES (?, ?)",
    [name, city || null],
    function (err) {
      if (err) return sendError(res, 500, err.message);

      db.get(
        "SELECT id, name, city FROM publishers WHERE id = ?",
        [this.lastID],
        (err2, row) => {
          if (err2) {
            logger.error(`[publisher-controller] POST / select created publisher failed: ${err2.message}`);
            return sendError(res, 500, err2.message);
          }
  
          publishEvent("publishers", row.id, "created");
          logger.info(`[publisher-controller] POST / created publisher ${row.id}`);
          res.status(201).json(row);
        }
      );
    }
  );
});

// Patch publisher by id
router.patch("/:id", (req, res) => {
  const { sendError, publishEvent, logger } = req.app.locals;
  const { id } = req.params;
  const { name, city } = req.body;

  logger.debug(`[publisher-controller] PATCH /${id} body=${JSON.stringify(req.body)}`);

  if (name === undefined && city === undefined) {
    logger.warn(`[publisher-controller] PATCH /${id} no fields`);
    return sendError(res, 400, "keine gültigen Felder (name, city)");
  }

  const sets = [];
  const params = [];

  if (name !== undefined) {
    if (!name) return sendError(res, 400, "name darf nicht leer sein");
    sets.push("name = ?");
    params.push(name);
  }
  if (city !== undefined) {
    sets.push("city = ?");
    params.push(city || null);
  }

  params.push(req.params.id);

  db.run(
    `UPDATE publishers SET ${sets.join(", ")} WHERE id = ?`,
    params,
    function (err) {
      if (err) {
        logger.error(`[publisher-controller] PATCH /${id} update failed: ${err.message}`);
        return sendError(res, 500, err.message);
      }
      if (this.changes === 0) {
        logger.warn(`[publisher-controller] PATCH /${id} not found`);
        return sendError(res, 404, "Verlag nicht gefunden");
      }

      db.get(
        "SELECT id, name, city FROM publishers WHERE id = ?",
        [req.params.id],
        (err2, row) => {
          if (err2) {
            logger.error(`[publisher-controller] PATCH /${id} select failed: ${err2.message}`);
            return sendError(res, 500, err2.message);
          }
     
          publishEvent("publishers", row.id, "updated");
          logger.info(`[publisher-controller] PATCH /${id} success`);
          res.json(row);
        }
      );
    }
  );
});

// delete publisher by id
router.delete("/:id", (req, res) => {
  const { sendError, publishEvent, logger } = req.app.locals;
  const { id } = req.params;
  logger.debug(`[publisher-controller] DELETE /${id}`);

  db.run("DELETE FROM publishers WHERE id = ?", [id], function (err) {
    if (err) {
      logger.error(`[publisher-controller] DELETE /${id} failed: ${err.message}`);
      if (err.message && err.message.includes("FOREIGN KEY")) {
        return sendError(
          res,
          400,
          "Verlag kann nicht gelöscht werden (noch von Büchern referenziert)"
        );
      }
      return sendError(res, 500, err.message);
    }
    if (this.changes === 0) {
      logger.warn(`[publisher-controller] DELETE /${id} not found`);
      return sendError(res, 404, "Verlag nicht gefunden");
    }

    publishEvent("publishers", Number(id), "deleted");
    logger.info(`[publisher-controller] DELETE /${id} deleted`);

    res.status(204).send();
  });
});

module.exports = router;