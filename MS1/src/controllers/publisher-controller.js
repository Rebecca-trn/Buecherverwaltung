const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /publishers (mit optionaler Suche ?q=)
router.get("/", (req, res) => {
  const { sendError } = req.app.locals;
  const q = (req.query.q || "").trim();

  if (!q) {
    db.all(
      "SELECT id, name, city FROM publishers ORDER BY id",
      [],
      (err, rows) => {
        if (err) return sendError(res, 500, err.message);
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
        if (err) return sendError(res, 500, err.message);
        res.json(rows);
      }
    );
  }
});

// GET /publishers/:id
router.get("/:id", (req, res) => {
  const { sendError } = req.app.locals;

  db.get(
    "SELECT id, name, city FROM publishers WHERE id = ?",
    [req.params.id],
    (err, row) => {
      if (err) return sendError(res, 500, err.message);
      if (!row) return sendError(res, 404, "Verlag nicht gefunden");
      res.json(row);
    }
  );
});

// POST /publishers
router.post("/", (req, res) => {
  const { sendError, publishEvent } = req.app.locals;
  const { name, city } = req.body;

  if (!name) return sendError(res, 400, "name fehlt");

  db.run(
    "INSERT INTO publishers (name, city) VALUES (?, ?)",
    [name, city || null],
    function (err) {
      if (err) return sendError(res, 500, err.message);

      db.get(
        "SELECT id, name, city FROM publishers WHERE id = ?",
        [this.lastID],
        (err2, row) => {
          if (err2) return sendError(res, 500, err2.message);
          // EVENT: created
          publishEvent("publishers", row.id, "created");
          res.status(201).json(row);
        }
      );
    }
  );
});

// PATCH /publishers/:id
router.patch("/:id", (req, res) => {
  const { sendError, publishEvent } = req.app.locals;
  const { name, city } = req.body;

  if (name === undefined && city === undefined) {
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
      if (err) return sendError(res, 500, err.message);
      if (this.changes === 0) return sendError(res, 404, "Verlag nicht gefunden");

      db.get(
        "SELECT id, name, city FROM publishers WHERE id = ?",
        [req.params.id],
        (err2, row) => {
          if (err2) return sendError(res, 500, err2.message);
          // EVENT: updated
          publishEvent("publishers", row.id, "updated");
          res.json(row);
        }
      );
    }
  );
});

// DELETE /publishers/:id
router.delete("/:id", (req, res) => {
  const { sendError, publishEvent } = req.app.locals;

  db.run("DELETE FROM publishers WHERE id = ?", [req.params.id], function (err) {
    if (err) {
      if (err.message && err.message.includes("FOREIGN KEY")) {
        return sendError(
          res,
          400,
          "Verlag kann nicht gelöscht werden (noch von Büchern referenziert)"
        );
      }
      return sendError(res, 500, err.message);
    }
    if (this.changes === 0) return sendError(res, 404, "Verlag nicht gefunden");

    // EVENT: deleted
    publishEvent("publishers", Number(req.params.id), "deleted");
    res.status(204).send();
  });
});

module.exports = router;