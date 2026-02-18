const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /authors (mit optionaler Suche ?q=)
router.get("/", (req, res) => {
  const { sendError } = req.app.locals;
  const q = (req.query.q || "").trim();

  if (!q) {
    db.all("SELECT id, name FROM authors ORDER BY id", [], (err, rows) => {
      if (err) return sendError(res, 500, err.message);
      res.json(rows);
    });
  } else {
    const like = `%${q}%`;
    db.all(
      "SELECT id, name FROM authors WHERE LOWER(name) LIKE LOWER(?) ORDER BY id",
      [like],
      (err, rows) => {
        if (err) return sendError(res, 500, err.message);
        res.json(rows);
      }
    );
  }
});

// GET /authors/:id
router.get("/:id", (req, res) => {
  const { sendError } = req.app.locals;

  db.get(
    "SELECT id, name FROM authors WHERE id = ?",
    [req.params.id],
    (err, row) => {
      if (err) return sendError(res, 500, err.message);
      if (!row) return sendError(res, 404, "Autor nicht gefunden");
      res.json(row);
    }
  );
});

// POST /authors
router.post("/", (req, res) => {
  const { sendError, publishEvent } = req.app.locals;
  const { name } = req.body;
  if (!name) return sendError(res, 400, "name fehlt");

  db.run("INSERT INTO authors (name) VALUES (?)", [name], function (err) {
    if (err) return sendError(res, 500, err.message);

    db.get(
      "SELECT id, name FROM authors WHERE id = ?",
      [this.lastID],
      (err2, row) => {
        if (err2) return sendError(res, 500, err2.message);
        // EVENT: created
        publishEvent("authors", row.id, "created");
        res.status(201).json(row);
      }
    );
  });
});

// PATCH /authors/:id
router.patch("/:id", (req, res) => {
  const { sendError, publishEvent } = req.app.locals;
  const { name } = req.body;
  if (!name) return sendError(res, 400, "name fehlt");

  db.run(
    "UPDATE authors SET name = ? WHERE id = ?",
    [name, req.params.id],
    function (err) {
      if (err) return sendError(res, 500, err.message);
      if (this.changes === 0) return sendError(res, 404, "Autor nicht gefunden");

      db.get(
        "SELECT id, name FROM authors WHERE id = ?",
        [req.params.id],
        (err2, row) => {
          if (err2) return sendError(res, 500, err2.message);
          // EVENT: updated
          publishEvent("authors", row.id, "updated");
          res.json(row);
        }
      );
    }
  );
});

// DELETE /authors/:id
router.delete("/:id", (req, res) => {
  const { sendError, publishEvent } = req.app.locals;

  db.run("DELETE FROM authors WHERE id = ?", [req.params.id], function (err) {
    if (err) {
      if (err.message && err.message.includes("FOREIGN KEY"))
        return sendError(res, 400, "Autor kann nicht gelöscht werden (noch von Büchern referenziert)");
      return sendError(res, 500, err.message);
    }
    if (this.changes === 0) return sendError(res, 404, "Autor nicht gefunden");

    // EVENT: deleted
    publishEvent("authors", Number(req.params.id), "deleted");
    res.status(204).send();
  });
});

module.exports = router;