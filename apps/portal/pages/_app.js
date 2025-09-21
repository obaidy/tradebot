"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = require("next-auth/react");
require("../styles/globals.css");
function App({ Component, pageProps: { session, ...pageProps } }) {
    return (<react_1.SessionProvider session={session}>
      <Component {...pageProps}/>
    </react_1.SessionProvider>);
}
exports.default = App;
