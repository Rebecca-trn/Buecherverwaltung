

const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /authors – alle Autoren
router.get("/", (req, res) => {
  db.all("SELECT * FROM authors ORDER BY id", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// GET /authors/:id – einzelner Autor
router.get("/:id", (req, res) => {
  db.get("SELECT * FROM authors WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Autor nicht gefunden" });
    res.json(row);
  });
});

// POST /authors – neuen Autor anlegen
router.post("/", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name fehlt" });

  db.run("INSERT INTO authors (name) VALUES (?)", [name], function (err) {
    if (err) return res.status(500).json({ error: err.message });

    db.get("SELECT * FROM authors WHERE id = ?", [this.lastID], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.status(201).json(row);
    });
  });
});

// PATCH /authors/:id – Autor ändern
router.patch("/:id", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name fehlt" });

  db.run("UPDATE authors SET name = ? WHERE id = ?", [name, req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Autor nicht gefunden" });

    db.get("SELECT * FROM authors WHERE id = ?", [req.params.id], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json(row);
    });
  });
});

// DELETE /authors/:id
router.delete("/:id", (req, res) => {
  db.run("DELETE FROM authors WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(400).json({ error: "Löschen nicht möglich" });
    if (this.changes === 0) return res.status(404).json({ error: "Autor nicht gefunden" });

    res.status(204).send();
  });
});

module.exports = router;