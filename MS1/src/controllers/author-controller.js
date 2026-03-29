const express = require("express");
const router = express.Router();
const db = require("../db");

// get authors
router.get("/", (req, res) => {
  const { sendError, logger } = req.app.locals;
  const q = (req.query.q || "").trim();
  logger.debug(`[author-controller] GET / q=${q}`);


  if (!q) {
    db.all("SELECT id, name FROM authors ORDER BY id", [], (err, rows) => {
      if (err) {
        logger.error(`[author-controller] GET / query failed: ${err.message}`);
        return sendError(res, 500, err.message);
      }
      logger.debug(`[author-controller] GET / returned ${rows.length} rows`);
      res.json(rows);
    });
  } else {
    const like = `%${q}%`;
    db.all(
      "SELECT id, name FROM authors WHERE LOWER(name) LIKE LOWER(?) ORDER BY id",
      [like],
      (err, rows) => {
        if (err) {
          logger.error(`[author-controller] GET / q=${q} failed: ${err.message}`);
          return sendError(res, 500, err.message);
        }
        logger.debug(`[author-controller] GET / q=${q} returned ${rows.length} rows`);
        res.json(rows);
      }
    );
  }
});

// get author by id
router.get("/:id", (req, res) => {
  const { sendError, logger } = req.app.locals;
  const { id } = req.params;
  logger.debug(`[author-controller] GET /${id}`);


  db.get(
    "SELECT id, name FROM authors WHERE id = ?",
    [req.params.id],
    (err, row) => {
      if (err) {
        logger.error(`[author-controller] GET /${id} failed: ${err.message}`);
        return sendError(res, 500, err.message);
      }
      if (!row) {
        logger.warn(`[author-controller] GET /${id} no author`);
        return sendError(res, 404, "Autor nicht gefunden");
      }
      logger.info(`[author-controller] GET /${id} success`);
      res.json(row);
    }
  );
});

// post author
router.post("/", (req, res) => {
  const { sendError, publishEvent, logger } = req.app.locals;
  const { name } = req.body;
  logger.debug(`[author-controller] POST / name=${name}`);
  if (!name) {
    logger.warn("[author-controller] POST / missing name");
    return sendError(res, 400, "name fehlt");
  }


  db.run("INSERT INTO authors (name) VALUES (?)", [name], function (err) {
    if (err) return sendError(res, 500, err.message);

    db.get(
      "SELECT id, name FROM authors WHERE id = ?",
      [this.lastID],
      (err2, row) => {
        if (err2) {
          logger.error(`[author-controller] POST / select created author failed: ${err2.message}`);
          return sendError(res, 500, err2.message);
        }

        publishEvent("authors", row.id, "created");
        logger.info(`[author-controller] POST / created author ${row.id}`);
        res.status(201).json(row);
      }
    );
  });
});

// Patch author by id
router.patch("/:id", (req, res) => {
  const { sendError, publishEvent, logger } = req.app.locals;
  const { name, birth_year } = req.body;
  const { id } = req.params;
  logger.debug(`[author-controller] PATCH /${id} body=${JSON.stringify(req.body)}`);

  if (name === undefined && birth_year === undefined) {
    logger.warn(`[author-controller] PATCH /${id} no fields`);
    return sendError(res, 400, "keine gültigen Felder (name, birth_year)");
  }

  const sets = [];
  const params = [];


  if (name !== undefined) {
    if (typeof name !== "string" || name.trim() === "") {
      logger.warn(`[author-controller] PATCH /${id} invalid name`);
      return sendError(res, 400, "name darf nicht leer sein");
    }
    const normalizedName = name.trim();
    sets.push("name = ?");
    params.push(normalizedName);
  }


  if (birth_year !== undefined) {
    let normalizedYear = birth_year;

    if (normalizedYear === "" || normalizedYear === null) {
      normalizedYear = null;
    } else {
      const currentYear = new Date().getFullYear();
      const y = Number(normalizedYear);
      if (!Number.isInteger(y) || y < 1500 || y > currentYear) {
        logger.warn(`[author-controller] PATCH /${id} invalid birth_year=${normalizedYear}`);
        return sendError(res, 400, `birth_year muss eine Ganzzahl zwischen 1500 und ${currentYear} sein`);
      }
      normalizedYear = y;
    }

    sets.push("birth_year = ?");
    params.push(normalizedYear);
  }


  if (sets.length === 0) {
    return sendError(res, 400, "keine gültigen Felder (name, birth_year)");
  }

  params.push(req.params.id);

  
  db.run(`UPDATE authors SET ${sets.join(", ")} WHERE id = ?`, params, function (err) {
    if (err) {
      logger.error(`[author-controller] PATCH /${id} update failed: ${err.message}`);
      const msg = String(err.message || "");
      if (msg.includes("UNIQUE") && msg.toLowerCase().includes("name")) {
        return sendError(res, 409, "Autorenname existiert bereits");
      }
      return sendError(res, 500, err.message);
    }
    if (this.changes === 0) {
      logger.warn(`[author-controller] PATCH /${id} not found`);
      return sendError(res, 404, "Autor nicht gefunden");
    }

    db.get("SELECT id, name, birth_year FROM authors WHERE id = ?", [req.params.id], (err2, row) => {
      if (err2) {
        logger.error(`[author-controller] PATCH /${id} select after update failed: ${err2.message}`);
        return sendError(res, 500, err2.message);
      }
      publishEvent("authors", row.id, "updated");
      logger.info(`[author-controller] PATCH /${id} success`);
      res.json(row);
    });
  });
});


// delete author by id
router.delete("/:id", (req, res) => {
  const { sendError, publishEvent, logger } = req.app.locals;
  const { id } = req.params;
  logger.debug(`[author-controller] DELETE /${id}`);

  db.run("DELETE FROM authors WHERE id = ?", [id], function (err) {
    if (err) {
      logger.error(`[author-controller] DELETE /${id} failed: ${err.message}`);
      if (err.message && err.message.includes("FOREIGN KEY"))
        return sendError(res, 400, "Autor kann nicht gelöscht werden (noch von Büchern referenziert)");
      return sendError(res, 500, err.message);
    }
    if (this.changes === 0) {
      logger.warn(`[author-controller] DELETE /${id} not found`);
      return sendError(res, 404, "Autor nicht gefunden");
    }

    // EVENT: deleted
    publishEvent("authors", Number(id), "deleted");
    logger.info(`[author-controller] DELETE /${id} deleted`);
    res.status(204).send();
  });
});

module.exports = router;