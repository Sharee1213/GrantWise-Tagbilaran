const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function initDatabase() {
    const schemaPath = path.join(__dirname, "schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf8");

    await pool.query(schemaSql);
    console.log("GrantWise database schema initialized successfully.");
    return true;
}

if (require.main === module) {
    initDatabase()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("Database initialization failed:", error);
            process.exit(1);
        });
}

module.exports = {
    initDatabase
};
