const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");
const { initDatabase } = require("./init-database");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        message: "GrantWise API is running!"
    });
});

app.get("/api/test-db", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW()");

        res.json({
            message: "Connected to Neon!",
            time: result.rows[0].now
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Database connection failed"
        });
    }
});

app.post("/api/init-db", async (req, res) => {
    try {
        await initDatabase();
        res.json({
            message: "GrantWise database schema initialized successfully."
        });
    } catch (error) {
        console.error("Schema initialization failed:", error);
        res.status(500).json({
            message: "Schema initialization failed",
            detail: error.message
        });
    }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});