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
exports.id = "pages/legal/[doc]";
exports.ids = ["pages/legal/[doc]"];
exports.modules = {

/***/ "./pages/legal/[doc].tsx":
/*!*******************************!*\
  !*** ./pages/legal/[doc].tsx ***!
  \*******************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (/* binding */ LegalDocument),\n/* harmony export */   \"getServerSideProps\": () => (/* binding */ getServerSideProps)\n/* harmony export */ });\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react/jsx-dev-runtime */ \"react/jsx-dev-runtime\");\n/* harmony import */ var react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var next_head__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next/head */ \"next/head\");\n/* harmony import */ var next_head__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(next_head__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var fs_promises__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! fs/promises */ \"fs/promises\");\n/* harmony import */ var fs_promises__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(fs_promises__WEBPACK_IMPORTED_MODULE_2__);\n/* harmony import */ var path__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! path */ \"path\");\n/* harmony import */ var path__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(path__WEBPACK_IMPORTED_MODULE_3__);\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! react */ \"react\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_4__);\n\n\n\n\nasync function readLegalDocument(slug) {\n    const candidates = [\n        path__WEBPACK_IMPORTED_MODULE_3___default().resolve(process.cwd(), \"legal\", `${slug}.md`),\n        path__WEBPACK_IMPORTED_MODULE_3___default().resolve(process.cwd(), \"..\", \"legal\", `${slug}.md`),\n        path__WEBPACK_IMPORTED_MODULE_3___default().resolve(process.cwd(), \"..\", \"..\", \"legal\", `${slug}.md`), \n    ];\n    for (const candidate of candidates){\n        try {\n            return await fs_promises__WEBPACK_IMPORTED_MODULE_2___default().readFile(candidate, \"utf8\");\n        } catch (err) {\n            if (err.code !== \"ENOENT\") {\n                throw err;\n            }\n        }\n    }\n    throw new Error(\"not_found\");\n}\n\nconst getServerSideProps = async (ctx)=>{\n    const doc = Array.isArray(ctx.params?.doc) ? ctx.params?.doc[0] : ctx.params?.doc ?? \"terms\";\n    try {\n        const content = await readLegalDocument(doc);\n        return {\n            props: {\n                doc,\n                name: doc === \"terms\" ? \"Terms of Service\" : doc === \"privacy\" ? \"Privacy Policy\" : doc === \"risk\" ? \"Risk Disclosure\" : doc,\n                content\n            }\n        };\n    } catch (err) {\n        return {\n            notFound: true\n        };\n    }\n};\nfunction LegalDocument({ doc , name , content  }) {\n    return /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.Fragment, {\n        children: [\n            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)((next_head__WEBPACK_IMPORTED_MODULE_1___default()), {\n                children: /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"title\", {\n                    children: name\n                }, void 0, false, {\n                    fileName: \"/Users/ahmed/Desktop/tradebot/apps/portal/pages/legal/[doc].tsx\",\n                    lineNumber: 60,\n                    columnNumber: 9\n                }, this)\n            }, void 0, false, {\n                fileName: \"/Users/ahmed/Desktop/tradebot/apps/portal/pages/legal/[doc].tsx\",\n                lineNumber: 59,\n                columnNumber: 7\n            }, this),\n            /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"main\", {\n                style: {\n                    maxWidth: 800,\n                    margin: \"2rem auto\",\n                    padding: \"0 1rem\",\n                    fontFamily: \"system-ui, sans-serif\"\n                },\n                children: [\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"h1\", {\n                        children: name\n                    }, void 0, false, {\n                        fileName: \"/Users/ahmed/Desktop/tradebot/apps/portal/pages/legal/[doc].tsx\",\n                        lineNumber: 63,\n                        columnNumber: 9\n                    }, this),\n                    /*#__PURE__*/ (0,react_jsx_dev_runtime__WEBPACK_IMPORTED_MODULE_0__.jsxDEV)(\"pre\", {\n                        style: {\n                            whiteSpace: \"pre-wrap\",\n                            background: \"#f1f5f9\",\n                            padding: \"1rem\",\n                            borderRadius: 8\n                        },\n                        children: content\n                    }, void 0, false, {\n                        fileName: \"/Users/ahmed/Desktop/tradebot/apps/portal/pages/legal/[doc].tsx\",\n                        lineNumber: 64,\n                        columnNumber: 9\n                    }, this)\n                ]\n            }, void 0, true, {\n                fileName: \"/Users/ahmed/Desktop/tradebot/apps/portal/pages/legal/[doc].tsx\",\n                lineNumber: 62,\n                columnNumber: 7\n            }, this)\n        ]\n    }, void 0, true);\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,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SixDQUFDIiwic291cmNlcyI6WyJ3ZWJwYWNrOi8vcG9ydGFsLy4vcGFnZXMvbGVnYWwvW2RvY10udHN4P2MwYTYiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgR2V0U2VydmVyU2lkZVByb3BzIH0gZnJvbSAnbmV4dCc7XG5pbXBvcnQgSGVhZCBmcm9tICduZXh0L2hlYWQnO1xuaW1wb3J0IGZzIGZyb20gJ2ZzL3Byb21pc2VzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuXG5hc3luYyBmdW5jdGlvbiByZWFkTGVnYWxEb2N1bWVudChzbHVnOiBzdHJpbmcpIHtcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtcbiAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2xlZ2FsJywgYCR7c2x1Z30ubWRgKSxcbiAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJy4uJywgJ2xlZ2FsJywgYCR7c2x1Z30ubWRgKSxcbiAgICBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJy4uJywgJy4uJywgJ2xlZ2FsJywgYCR7c2x1Z30ubWRgKSxcbiAgXTtcbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgZnMucmVhZEZpbGUoY2FuZGlkYXRlLCAndXRmOCcpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKChlcnIgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKS5jb2RlICE9PSAnRU5PRU5UJykge1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHRocm93IG5ldyBFcnJvcignbm90X2ZvdW5kJyk7XG59XG5pbXBvcnQgUmVhY3QgZnJvbSAncmVhY3QnO1xuXG5pbnRlcmZhY2UgUHJvcHMge1xuICBkb2M6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjb25zdCBnZXRTZXJ2ZXJTaWRlUHJvcHM6IEdldFNlcnZlclNpZGVQcm9wczxQcm9wcz4gPSBhc3luYyAoY3R4KSA9PiB7XG4gIGNvbnN0IGRvYyA9IEFycmF5LmlzQXJyYXkoY3R4LnBhcmFtcz8uZG9jKSA/IGN0eC5wYXJhbXM/LmRvY1swXSA6IGN0eC5wYXJhbXM/LmRvYyA/PyAndGVybXMnO1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCByZWFkTGVnYWxEb2N1bWVudChkb2MpO1xuICAgIHJldHVybiB7XG4gICAgICBwcm9wczoge1xuICAgICAgICBkb2MsXG4gICAgICAgIG5hbWU6XG4gICAgICAgICAgZG9jID09PSAndGVybXMnXG4gICAgICAgICAgICA/ICdUZXJtcyBvZiBTZXJ2aWNlJ1xuICAgICAgICAgICAgOiBkb2MgPT09ICdwcml2YWN5J1xuICAgICAgICAgICAgPyAnUHJpdmFjeSBQb2xpY3knXG4gICAgICAgICAgICA6IGRvYyA9PT0gJ3Jpc2snXG4gICAgICAgICAgICA/ICdSaXNrIERpc2Nsb3N1cmUnXG4gICAgICAgICAgICA6IGRvYyxcbiAgICAgICAgY29udGVudCxcbiAgICAgIH0sXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG5vdEZvdW5kOiB0cnVlLFxuICAgIH07XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIExlZ2FsRG9jdW1lbnQoeyBkb2MsIG5hbWUsIGNvbnRlbnQgfTogUHJvcHMpIHtcbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAgPEhlYWQ+XG4gICAgICAgIDx0aXRsZT57bmFtZX08L3RpdGxlPlxuICAgICAgPC9IZWFkPlxuICAgICAgPG1haW4gc3R5bGU9e3sgbWF4V2lkdGg6IDgwMCwgbWFyZ2luOiAnMnJlbSBhdXRvJywgcGFkZGluZzogJzAgMXJlbScsIGZvbnRGYW1pbHk6ICdzeXN0ZW0tdWksIHNhbnMtc2VyaWYnIH19PlxuICAgICAgICA8aDE+e25hbWV9PC9oMT5cbiAgICAgICAgPHByZSBzdHlsZT17eyB3aGl0ZVNwYWNlOiAncHJlLXdyYXAnLCBiYWNrZ3JvdW5kOiAnI2YxZjVmOScsIHBhZGRpbmc6ICcxcmVtJywgYm9yZGVyUmFkaXVzOiA4IH19Pntjb250ZW50fTwvcHJlPlxuICAgICAgPC9tYWluPlxuICAgIDwvPlxuICApO1xufVxuIl0sIm5hbWVzIjpbIkhlYWQiLCJmcyIsInBhdGgiLCJyZWFkTGVnYWxEb2N1bWVudCIsInNsdWciLCJjYW5kaWRhdGVzIiwicmVzb2x2ZSIsInByb2Nlc3MiLCJjd2QiLCJjYW5kaWRhdGUiLCJyZWFkRmlsZSIsImVyciIsImNvZGUiLCJFcnJvciIsIlJlYWN0IiwiZ2V0U2VydmVyU2lkZVByb3BzIiwiY3R4IiwiZG9jIiwiQXJyYXkiLCJpc0FycmF5IiwicGFyYW1zIiwiY29udGVudCIsInByb3BzIiwibmFtZSIsIm5vdEZvdW5kIiwiTGVnYWxEb2N1bWVudCIsInRpdGxlIiwibWFpbiIsInN0eWxlIiwibWF4V2lkdGgiLCJtYXJnaW4iLCJwYWRkaW5nIiwiZm9udEZhbWlseSIsImgxIiwicHJlIiwid2hpdGVTcGFjZSIsImJhY2tncm91bmQiLCJib3JkZXJSYWRpdXMiXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///./pages/legal/[doc].tsx\n");

/***/ }),

/***/ "next/head":
/*!****************************!*\
  !*** external "next/head" ***!
  \****************************/
/***/ ((module) => {

module.exports = require("next/head");

/***/ }),

/***/ "react":
/*!************************!*\
  !*** external "react" ***!
  \************************/
/***/ ((module) => {

module.exports = require("react");

/***/ }),

/***/ "react/jsx-dev-runtime":
/*!****************************************!*\
  !*** external "react/jsx-dev-runtime" ***!
  \****************************************/
/***/ ((module) => {

module.exports = require("react/jsx-dev-runtime");

/***/ }),

/***/ "fs/promises":
/*!******************************!*\
  !*** external "fs/promises" ***!
  \******************************/
/***/ ((module) => {

module.exports = require("fs/promises");

/***/ }),

/***/ "path":
/*!***********************!*\
  !*** external "path" ***!
  \***********************/
/***/ ((module) => {

module.exports = require("path");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../../webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = (__webpack_exec__("./pages/legal/[doc].tsx"));
module.exports = __webpack_exports__;

})();