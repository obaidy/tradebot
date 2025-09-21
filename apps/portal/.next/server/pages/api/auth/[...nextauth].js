"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "pages/api/auth/[...nextauth]";
exports.ids = ["pages/api/auth/[...nextauth]"];
exports.modules = {

/***/ "next-auth":
/*!****************************!*\
  !*** external "next-auth" ***!
  \****************************/
/***/ ((module) => {

module.exports = require("next-auth");

/***/ }),

/***/ "next-auth/providers/auth0":
/*!********************************************!*\
  !*** external "next-auth/providers/auth0" ***!
  \********************************************/
/***/ ((module) => {

module.exports = require("next-auth/providers/auth0");

/***/ }),

/***/ "(api)/./lib/authOptions.js":
/*!****************************!*\
  !*** ./lib/authOptions.js ***!
  \****************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

eval("\nvar __importDefault = (void 0) && (void 0).__importDefault || function(mod) {\n    return mod && mod.__esModule ? mod : {\n        \"default\": mod\n    };\n};\nObject.defineProperty(exports, \"__esModule\", ({\n    value: true\n}));\nexports.authOptions = void 0;\nconst auth0_1 = __importDefault(__webpack_require__(/*! next-auth/providers/auth0 */ \"next-auth/providers/auth0\"));\nconst auth0Domain = process.env.AUTH0_ISSUER_BASE_URL;\nconst auth0ClientId = process.env.AUTH0_CLIENT_ID;\nconst auth0ClientSecret = process.env.AUTH0_CLIENT_SECRET;\nif (!process.env.NEXTAUTH_SECRET) {\n    // eslint-disable-next-line no-console\n    console.warn(\"NEXTAUTH_SECRET is not set. Sessions may be insecure in production.\");\n}\nexports.authOptions = {\n    providers: [\n        (0, auth0_1.default)({\n            clientId: auth0ClientId ?? \"\",\n            clientSecret: auth0ClientSecret ?? \"\",\n            issuer: auth0Domain,\n            authorization: {\n                params: {\n                    scope: \"openid email profile\"\n                }\n            }\n        }), \n    ],\n    session: {\n        strategy: \"jwt\"\n    },\n    callbacks: {\n        async session ({ session , token  }) {\n            if (session.user) {\n                session.user.id = token.sub ?? session.user.email ?? \"\";\n            }\n            return session;\n        }\n    }\n};\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKGFwaSkvLi9saWIvYXV0aE9wdGlvbnMuanMuanMiLCJtYXBwaW5ncyI6IkFBQWE7QUFDYixJQUFJQSxlQUFlLEdBQUcsQ0FBQyxNQUFJLEtBQUksT0FBSSxFQUFDQSxlQUFlLElBQUssU0FBVUMsR0FBRyxFQUFFO0lBQ25FLE9BQU8sR0FBSSxJQUFJQSxHQUFHLENBQUNDLFVBQVUsR0FBSUQsR0FBRyxHQUFHO1FBQUUsU0FBUyxFQUFFQSxHQUFHO0tBQUUsQ0FBQztBQUM5RCxDQUFDO0FBQ0RFLDhDQUE2QztJQUFFRyxLQUFLLEVBQUUsSUFBSTtDQUFFLEVBQUMsQ0FBQztBQUM5REQsbUJBQW1CLEdBQUcsS0FBSyxDQUFDLENBQUM7QUFDN0IsTUFBTUcsT0FBTyxHQUFHUixlQUFlLENBQUNTLG1CQUFPLENBQUMsNERBQTJCLENBQUMsQ0FBQztBQUNyRSxNQUFNQyxXQUFXLEdBQUdDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDQyxxQkFBcUI7QUFDckQsTUFBTUMsYUFBYSxHQUFHSCxPQUFPLENBQUNDLEdBQUcsQ0FBQ0csZUFBZTtBQUNqRCxNQUFNQyxpQkFBaUIsR0FBR0wsT0FBTyxDQUFDQyxHQUFHLENBQUNLLG1CQUFtQjtBQUN6RCxJQUFJLENBQUNOLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDTSxlQUFlLEVBQUU7SUFDOUIsc0NBQXNDO0lBQ3RDQyxPQUFPLENBQUNDLElBQUksQ0FBQyxxRUFBcUUsQ0FBQyxDQUFDO0FBQ3hGLENBQUM7QUFDRGYsbUJBQW1CLEdBQUc7SUFDbEJnQixTQUFTLEVBQUU7UUFDTixFQUFDLEVBQUViLE9BQU8sQ0FBQ2MsT0FBTyxFQUFFO1lBQ2pCQyxRQUFRLEVBQUVULGFBQWEsSUFBSSxFQUFFO1lBQzdCVSxZQUFZLEVBQUVSLGlCQUFpQixJQUFJLEVBQUU7WUFDckNTLE1BQU0sRUFBRWYsV0FBVztZQUNuQmdCLGFBQWEsRUFBRTtnQkFDWEMsTUFBTSxFQUFFO29CQUNKQyxLQUFLLEVBQUUsc0JBQXNCO2lCQUNoQzthQUNKO1NBQ0osQ0FBQztLQUNMO0lBQ0RDLE9BQU8sRUFBRTtRQUNMQyxRQUFRLEVBQUUsS0FBSztLQUNsQjtJQUNEQyxTQUFTLEVBQUU7UUFDUCxNQUFNRixPQUFPLEVBQUMsRUFBRUEsT0FBTyxHQUFFRyxLQUFLLEdBQUUsRUFBRTtZQUM5QixJQUFJSCxPQUFPLENBQUNJLElBQUksRUFBRTtnQkFDZEosT0FBTyxDQUFDSSxJQUFJLENBQUNDLEVBQUUsR0FBR0YsS0FBSyxDQUFDRyxHQUFHLElBQUlOLE9BQU8sQ0FBQ0ksSUFBSSxDQUFDRyxLQUFLLElBQUksRUFBRSxDQUFDO1lBQzVELENBQUM7WUFDRCxPQUFPUCxPQUFPLENBQUM7UUFDbkIsQ0FBQztLQUNKO0NBQ0osQ0FBQyIsInNvdXJjZXMiOlsid2VicGFjazovL3BvcnRhbC8uL2xpYi9hdXRoT3B0aW9ucy5qcz9hOWM4Il0sInNvdXJjZXNDb250ZW50IjpbIlwidXNlIHN0cmljdFwiO1xudmFyIF9faW1wb3J0RGVmYXVsdCA9ICh0aGlzICYmIHRoaXMuX19pbXBvcnREZWZhdWx0KSB8fCBmdW5jdGlvbiAobW9kKSB7XG4gICAgcmV0dXJuIChtb2QgJiYgbW9kLl9fZXNNb2R1bGUpID8gbW9kIDogeyBcImRlZmF1bHRcIjogbW9kIH07XG59O1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsIFwiX19lc01vZHVsZVwiLCB7IHZhbHVlOiB0cnVlIH0pO1xuZXhwb3J0cy5hdXRoT3B0aW9ucyA9IHZvaWQgMDtcbmNvbnN0IGF1dGgwXzEgPSBfX2ltcG9ydERlZmF1bHQocmVxdWlyZShcIm5leHQtYXV0aC9wcm92aWRlcnMvYXV0aDBcIikpO1xuY29uc3QgYXV0aDBEb21haW4gPSBwcm9jZXNzLmVudi5BVVRIMF9JU1NVRVJfQkFTRV9VUkw7XG5jb25zdCBhdXRoMENsaWVudElkID0gcHJvY2Vzcy5lbnYuQVVUSDBfQ0xJRU5UX0lEO1xuY29uc3QgYXV0aDBDbGllbnRTZWNyZXQgPSBwcm9jZXNzLmVudi5BVVRIMF9DTElFTlRfU0VDUkVUO1xuaWYgKCFwcm9jZXNzLmVudi5ORVhUQVVUSF9TRUNSRVQpIHtcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgIGNvbnNvbGUud2FybignTkVYVEFVVEhfU0VDUkVUIGlzIG5vdCBzZXQuIFNlc3Npb25zIG1heSBiZSBpbnNlY3VyZSBpbiBwcm9kdWN0aW9uLicpO1xufVxuZXhwb3J0cy5hdXRoT3B0aW9ucyA9IHtcbiAgICBwcm92aWRlcnM6IFtcbiAgICAgICAgKDAsIGF1dGgwXzEuZGVmYXVsdCkoe1xuICAgICAgICAgICAgY2xpZW50SWQ6IGF1dGgwQ2xpZW50SWQgPz8gJycsXG4gICAgICAgICAgICBjbGllbnRTZWNyZXQ6IGF1dGgwQ2xpZW50U2VjcmV0ID8/ICcnLFxuICAgICAgICAgICAgaXNzdWVyOiBhdXRoMERvbWFpbixcbiAgICAgICAgICAgIGF1dGhvcml6YXRpb246IHtcbiAgICAgICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgICAgICAgc2NvcGU6ICdvcGVuaWQgZW1haWwgcHJvZmlsZScsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgIF0sXG4gICAgc2Vzc2lvbjoge1xuICAgICAgICBzdHJhdGVneTogJ2p3dCcsXG4gICAgfSxcbiAgICBjYWxsYmFja3M6IHtcbiAgICAgICAgYXN5bmMgc2Vzc2lvbih7IHNlc3Npb24sIHRva2VuIH0pIHtcbiAgICAgICAgICAgIGlmIChzZXNzaW9uLnVzZXIpIHtcbiAgICAgICAgICAgICAgICBzZXNzaW9uLnVzZXIuaWQgPSB0b2tlbi5zdWIgPz8gc2Vzc2lvbi51c2VyLmVtYWlsID8/ICcnO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHNlc3Npb247XG4gICAgICAgIH0sXG4gICAgfSxcbn07XG4iXSwibmFtZXMiOlsiX19pbXBvcnREZWZhdWx0IiwibW9kIiwiX19lc01vZHVsZSIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZXhwb3J0cyIsInZhbHVlIiwiYXV0aE9wdGlvbnMiLCJhdXRoMF8xIiwicmVxdWlyZSIsImF1dGgwRG9tYWluIiwicHJvY2VzcyIsImVudiIsIkFVVEgwX0lTU1VFUl9CQVNFX1VSTCIsImF1dGgwQ2xpZW50SWQiLCJBVVRIMF9DTElFTlRfSUQiLCJhdXRoMENsaWVudFNlY3JldCIsIkFVVEgwX0NMSUVOVF9TRUNSRVQiLCJORVhUQVVUSF9TRUNSRVQiLCJjb25zb2xlIiwid2FybiIsInByb3ZpZGVycyIsImRlZmF1bHQiLCJjbGllbnRJZCIsImNsaWVudFNlY3JldCIsImlzc3VlciIsImF1dGhvcml6YXRpb24iLCJwYXJhbXMiLCJzY29wZSIsInNlc3Npb24iLCJzdHJhdGVneSIsImNhbGxiYWNrcyIsInRva2VuIiwidXNlciIsImlkIiwic3ViIiwiZW1haWwiXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(api)/./lib/authOptions.js\n");

/***/ }),

/***/ "(api)/./pages/api/auth/[...nextauth].ts":
/*!*****************************************!*\
  !*** ./pages/api/auth/[...nextauth].ts ***!
  \*****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (__WEBPACK_DEFAULT_EXPORT__)\n/* harmony export */ });\n/* harmony import */ var next_auth__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next-auth */ \"next-auth\");\n/* harmony import */ var next_auth__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(next_auth__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _lib_authOptions__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../../lib/authOptions */ \"(api)/./lib/authOptions.js\");\n\n\n/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (next_auth__WEBPACK_IMPORTED_MODULE_0___default()(_lib_authOptions__WEBPACK_IMPORTED_MODULE_1__.authOptions));\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKGFwaSkvLi9wYWdlcy9hcGkvYXV0aC9bLi4ubmV4dGF1dGhdLnRzLmpzIiwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBaUM7QUFDc0I7QUFFdkQsaUVBQWVBLGdEQUFRLENBQUNDLHlEQUFXLENBQUMsRUFBQyIsInNvdXJjZXMiOlsid2VicGFjazovL3BvcnRhbC8uL3BhZ2VzL2FwaS9hdXRoL1suLi5uZXh0YXV0aF0udHM/MmU4YiJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgTmV4dEF1dGggZnJvbSAnbmV4dC1hdXRoJztcbmltcG9ydCB7IGF1dGhPcHRpb25zIH0gZnJvbSAnLi4vLi4vLi4vbGliL2F1dGhPcHRpb25zJztcblxuZXhwb3J0IGRlZmF1bHQgTmV4dEF1dGgoYXV0aE9wdGlvbnMpO1xuIl0sIm5hbWVzIjpbIk5leHRBdXRoIiwiYXV0aE9wdGlvbnMiXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(api)/./pages/api/auth/[...nextauth].ts\n");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../../../webpack-api-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = (__webpack_exec__("(api)/./pages/api/auth/[...nextauth].ts"));
module.exports = __webpack_exports__;

})();