const ts = require("typescript");
const fs = require("fs");

const {
  isNewMooseResourceWithTypeParam,
} = require("/home/omar_rahman/moosefork/moosestack/packages/ts-moose-lib/dist/dmv2/index.js");
console.log(
  "Checking if the old loose function exported:",
  !!isNewMooseResourceWithTypeParam,
);
