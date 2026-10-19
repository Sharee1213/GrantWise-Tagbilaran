require("dotenv").config();

const { createApp } = require("./app");

const app = createApp();

const PORT = process.env.PORT || 5000;

if (require.main === module) {
    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
    server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
            console.error(`Unable to start server: port ${PORT} is already in use.`);
        } else {
            console.error(
                `Unable to start server${error.code ? ` (${error.code})` : ""}.`
            );
        }
        process.exitCode = 1;
    });
}

module.exports = app;