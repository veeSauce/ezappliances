require('dotenv').config();

const { installConsoleCapture } = require('./src/lib/appLogs');
installConsoleCapture();

const app = require('./src/app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`EZAppliances server listening on port ${PORT}`));
