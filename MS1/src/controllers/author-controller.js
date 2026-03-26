const express = require("express");
const router = express.Router();
const db = require("../db");

// get authors
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

// get author by id
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

// post author
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
 
        publishEvent("authors", row.id, "created");
        res.status(201).json(row);
      }
    );
  });
});

// Patch author by id
router.patch("/:id", (req, res) => {
  const { sendError, publishEvent } = req.app.locals;
  const { name, birth_year } = req.body; 

  if (name === undefined && birth_year === undefined) {
    return sendError(res, 400, "keine gültigen Felder (name, birth_year)");
  }

  const sets = [];
  const params = [];


  if (name !== undefined) {
    if (typeof name !== "string" || name.trim() === "") {
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

      const msg = String(err.message || "");
      if (msg.includes("UNIQUE") && msg.toLowerCase().includes("name")) {
        return sendError(res, 409, "Autorenname existiert bereits");
      }
      return sendError(res, 500, err.message);
    }
    if (this.changes === 0) return sendError(res, 404, "Autor nicht gefunden");

    db.get("SELECT id, name, birth_year FROM authors WHERE id = ?", [req.params.id], (err2, row) => {
      if (err2) return sendError(res, 500, err2.message);
      publishEvent("authors", row.id, "updated");
      res.json(row);
    });
  });
});


// delete author by id
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