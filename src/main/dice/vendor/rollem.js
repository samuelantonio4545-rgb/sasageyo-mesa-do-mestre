"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = exports.SyntaxError = void 0;
const crypto_1 = require("crypto");
// Mesa do Mestre: cap random work per parse, including exploding dice.
let mesaRandomBudget = 10000;
function mesaRandomInt(size) {
    if (--mesaRandomBudget < 0 || !Number.isSafeInteger(size) || size > 1000000) {
        const limit = new Error('Limite de dados excedido (10.000 sorteios ou 1.000.000 faces).');
        limit.location = 'CUSTOM';
        throw limit;
    }
    return crypto_1.randomInt(size);
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}
// Object Format:
// {
//   value = 27,
//   values = [ value1, value2, value3 ],
//   pretties = "[value1, value2, **value3**]",
//   label = "Anything you want",
//   dice = 0
// }
function maxEvaluator(size) { return size; }
function minEvaluator(size) { return 1; }
function rollEvaluator(size, explodeConfiguration) {
    var all_rolls = [];
    var minimumExplodeSize = (explodeConfiguration && explodeConfiguration.value)
        ? explodeConfiguration.value
        : size;
    if (minimumExplodeSize <= 1) {
        error("Explode value must be greater than 1.", "CUSTOM");
    }
    if (minimumExplodeSize < size / 1000) {
        error("Explode chance must be less than 99.9%", "CUSTOM");
    }
    do {
        var last_roll = mesaRandomInt(size) + 1;
        all_rolls.push(last_roll);
    } while (last_roll >= minimumExplodeSize && explodeConfiguration);
    return all_rolls;
}
function makeCounter(left, expr, right) {
    var evaluator = (i) => { throw new Error("No evaluator set."); };
    switch (expr) {
        case "<<":
            evaluator = function (v) { return v <= right.value; };
            break;
        case ">>":
            evaluator = function (v) { return v >= right.value; };
            break;
    }
    var count = 0;
    left.values.forEach(function (v, i, arr) { if (evaluator(v)) {
        count++;
    } });
    return {
        "value": count,
        "values": [count],
        "pretties": left.pretties + " " + expr + " " + right.pretties,
        "depth": Math.max(left.depth, right.depth) + 1,
        "dice": left.dice + right.dice
    };
}
function makeInteger(text) {
    var value = parseInt(text, 10);
    return {
        "value": value,
        "values": [value],
        "pretties": text,
        "depth": 1,
        "dice": 0
    };
}
// TODO: generalize roll structure
function makeFateRoll(left) {
    var size = 3;
    var count = left ? left.value : 1;
    if (count > 100) {
        error("Maximum die count is 100.", "CUSTOM");
    }
    var valuesArr = [];
    // roll
    for (var i = 0; i < count; i++) {
        var newVals = singleDieEvaluator(size);
        Array.prototype.push.apply(valuesArr, newVals);
    }
    // map d3 to -1 0 1
    valuesArr = valuesArr.map(v => v - 2);
    // total
    var accumulator = 0;
    valuesArr.forEach(function (v, i, arr) { accumulator += v; });
    // make pretties int - 0 +
    var prettiesArr = valuesArr.sort((a, b) => a - b).reverse().map(function (v, i, arr) {
        switch (v) {
            case 0: return "0";
            case 1: return "+";
            case -1: return "-";
            default: return "broken";
        }
    });
    var pretties = "[" + prettiesArr.join(", ") + "]" + count + "dF";
    valuesArr = valuesArr.sort((a, b) => a - b);
    var depth = left ? left.depth + 1 : 2;
    var dice = left ? left.value : 1;
    return {
        "value": accumulator,
        "values": valuesArr,
        "pretties": pretties,
        "depth": depth,
        "dice": dice
    };
}
function makeBasicRoll(left, right, explodeConfiguration, configuration) {
    var size = right.value;
    var count = left ? left.value : 1;
    var allSameAndExplode = configuration.allSameAndExplode;
    var noSort = configuration.noSort || allSameAndExplode;
    var keepDropOperator = configuration.operator;
    var keepDropValue = clamp(configuration.value || 0, 0, count);
    if (size <= 1) {
        error("Minimum die size is 2.", "CUSTOM");
    }
    if (count > 100) {
        error("Maximum die count is 100.", "CUSTOM");
    }
    var valuesArr = [];
    // roll
    for (var i = 0; i < count; i++) {
        var newVals = singleDieEvaluator(size, explodeConfiguration);
        Array.prototype.push.apply(valuesArr, newVals);
    }
    // allSameAndExplode
    if (allSameAndExplode && valuesArr.length >= 2) {
        var allSame = valuesArr.every(v => v == valuesArr[0]);
        while (allSame) {
            var newVals = singleDieEvaluator(size, explodeConfiguration);
            allSame = newVals.every(v => v == valuesArr[0]);
            Array.prototype.push.apply(valuesArr, newVals);
        }
    }
    // handle keep-drop
    var augmentedValuesArr = valuesArr.map(v => { return { value: v, isKept: false }; });
    var sortedAugmentedValuesArr = Array.from(augmentedValuesArr).sort((a, b) => a.value - b.value).reverse();
    var keepRangeStart = 0;
    var keepRangeEndExclusive = sortedAugmentedValuesArr.length;
    var critrange = size;
    switch (keepDropOperator) {
        case "kh":
            keepRangeEndExclusive = keepDropValue;
            break;
        case "kl":
            keepRangeStart = sortedAugmentedValuesArr.length - keepDropValue;
            break;
        case "dh":
            keepRangeStart = keepDropValue;
            break;
        case "dl":
            keepRangeEndExclusive = sortedAugmentedValuesArr.length - keepDropValue;
            break;
        case "c":
            critrange = configuration.value;
            keepDropValue = critrange;
            break;
        default:
            // leave it at the default (keep everything)
            break;
    }
    sortedAugmentedValuesArr.slice(keepRangeStart, keepRangeEndExclusive).forEach(v => v.isKept = true);
    // total
    var accumulator = 0;
    augmentedValuesArr.filter(v => v.isKept).forEach((v, i, arr) => accumulator += v.value);
    // format
    var formatOrder = noSort ? augmentedValuesArr : sortedAugmentedValuesArr;
    var prettiesArr = formatOrder.map((v, i, arr) => {
        //critrange is by default = to size 
        return dieFormatter(v.value, critrange, v.isKept);
    });
    var pretties = "[" + prettiesArr.join(", ") + "]" + count + "d" + right.pretties;
    if (explodeConfiguration) {
        pretties = pretties + "!";
        if (explodeConfiguration.value) {
            pretties = pretties + explodeConfiguration.value;
        }
    }
    if (keepDropOperator) {
        pretties = pretties + keepDropOperator + keepDropValue;
    }
    valuesArr = sortedAugmentedValuesArr.filter(v => v.isKept).map(v => v.value);
    var depth = left ? Math.max(left.depth, right.depth) + 1 : right.depth + 1;
    var dice = left ? left.value : 1;
    return {
        "value": accumulator,
        "values": valuesArr,
        "pretties": pretties,
        "depth": depth,
        "dice": dice
    };
}
// This is used to configure how the dice calculations are performed.
var singleDieEvaluator = rollEvaluator;
// This is used to configure stylization of the individual die results.
function dieFormatter(value, size, isKept = true) {
    var formatted = value;
    if (value >= size)
        formatted = maxFormatter(formatted);
    else if (value == 1)
        formatted = minFormatter(formatted);
    if (!isKept)
        formatted = dropFormatter(formatted);
    return formatted;
}
function minFormatter(formatted) {
    return "**" + formatted + "**";
}
function maxFormatter(formatted) {
    return "**" + formatted + "**";
}
function dropFormatter(formatted) {
    return "~~" + formatted + "~~";
}
function makeBurningWheelNumber(left) {
    switch (left) {
        case "B":
            return makeInteger("4");
            break;
        case "G":
            return makeInteger("3");
            break;
        case "W":
            return makeInteger("2");
            break;
    }
}
// Generated by PEG.js v. 0.10.0 (ts-pegjs plugin v. 0.3.1 )
//
// https://pegjs.org/   https://github.com/metadevpro/ts-pegjs
"use strict";
class SyntaxError extends Error {
    static buildMessage(expected, found) {
        function hex(ch) {
            return ch.charCodeAt(0).toString(16).toUpperCase();
        }
        function literalEscape(s) {
            return s
                .replace(/\\/g, "\\\\")
                .replace(/"/g, "\\\"")
                .replace(/\0/g, "\\0")
                .replace(/\t/g, "\\t")
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r")
                .replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch))
                .replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch));
        }
        function classEscape(s) {
            return s
                .replace(/\\/g, "\\\\")
                .replace(/\]/g, "\\]")
                .replace(/\^/g, "\\^")
                .replace(/-/g, "\\-")
                .replace(/\0/g, "\\0")
                .replace(/\t/g, "\\t")
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r")
                .replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch))
                .replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch));
        }
        function describeExpectation(expectation) {
            switch (expectation.type) {
                case "literal":
                    return "\"" + literalEscape(expectation.text) + "\"";
                case "class":
                    const escapedParts = expectation.parts.map((part) => {
                        return Array.isArray(part)
                            ? classEscape(part[0]) + "-" + classEscape(part[1])
                            : classEscape(part);
                    });
                    return "[" + (expectation.inverted ? "^" : "") + escapedParts + "]";
                case "any":
                    return "any character";
                case "end":
                    return "end of input";
                case "other":
                    return expectation.description;
            }
        }
        function describeExpected(expected1) {
            const descriptions = expected1.map(describeExpectation);
            let i;
            let j;
            descriptions.sort();
            if (descriptions.length > 0) {
                for (i = 1, j = 1; i < descriptions.length; i++) {
                    if (descriptions[i - 1] !== descriptions[i]) {
                        descriptions[j] = descriptions[i];
                        j++;
                    }
                }
                descriptions.length = j;
            }
            switch (descriptions.length) {
                case 1:
                    return descriptions[0];
                case 2:
                    return descriptions[0] + " or " + descriptions[1];
                default:
                    return descriptions.slice(0, -1).join(", ")
                        + ", or "
                        + descriptions[descriptions.length - 1];
            }
        }
        function describeFound(found1) {
            return found1 ? "\"" + literalEscape(found1) + "\"" : "end of input";
        }
        return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
    }
    message;
    expected;
    found;
    location;
    name;
    constructor(message, expected, found, location) {
        super();
        this.message = message;
        this.expected = expected;
        this.found = found;
        this.location = location;
        this.name = "SyntaxError";
        if (typeof Error.captureStackTrace === "function") {
            Error.captureStackTrace(this, SyntaxError);
        }
    }
}
exports.SyntaxError = SyntaxError;
function peg$parse(input, options) {
    mesaRandomBudget = 10000;
    options = options !== undefined ? options : {};
    const peg$FAILED = {};
    const peg$startRuleFunctions = { start: peg$parsestart };
    let peg$startRuleFunction = peg$parsestart;
    const peg$c0 = function (result, label) {
        result.label = label;
        result.values = result.values;
        return result;
    };
    const peg$c1 = function (label) {
        return label;
    };
    const peg$c2 = "<=";
    const peg$c3 = peg$literalExpectation("<=", false);
    const peg$c4 = ">=";
    const peg$c5 = peg$literalExpectation(">=", false);
    const peg$c6 = "==";
    const peg$c7 = peg$literalExpectation("==", false);
    const peg$c8 = "=";
    const peg$c9 = peg$literalExpectation("=", false);
    const peg$c10 = "<";
    const peg$c11 = peg$literalExpectation("<", false);
    const peg$c12 = ">";
    const peg$c13 = peg$literalExpectation(">", false);
    const peg$c14 = function (left, expr, right) {
        var wasSuccess = false;
        switch (expr) {
            case "<":
                wasSuccess = left.value < right.value;
                break;
            case "<=":
                wasSuccess = left.value <= right.value;
                break;
            case ">":
                wasSuccess = left.value > right.value;
                break;
            case ">=":
                wasSuccess = left.value >= right.value;
                break;
            case "=":
            case "==":
                wasSuccess = left.value == right.value;
                break;
        }
        var withValue = left.value + " " + expr + " " + right.value +
            " ⟵ " + left.pretties + " " + expr + " " + right.pretties;
        var value = wasSuccess;
        var values = wasSuccess ? [1] : [0];
        return {
            "value": value,
            "values": values,
            "pretties": withValue,
            "depth": Math.max(left.depth, right.depth) + 1,
            "dice": left.dice + right.dice
        };
    };
    const peg$c15 = "<<";
    const peg$c16 = peg$literalExpectation("<<", false);
    const peg$c17 = ">>";
    const peg$c18 = peg$literalExpectation(">>", false);
    const peg$c19 = function (left, expr, right) {
        return makeCounter(left, expr, right);
    };
    const peg$c20 = "++";
    const peg$c21 = peg$literalExpectation("++", false);
    const peg$c22 = "--";
    const peg$c23 = peg$literalExpectation("--", false);
    const peg$c24 = "+";
    const peg$c25 = peg$literalExpectation("+", false);
    const peg$c26 = "-";
    const peg$c27 = peg$literalExpectation("-", false);
    const peg$c28 = function (left, right) {
        var result = left, i;
        result.values = [...left.values];
        for (i = 0; i < right.length; i++) {
            var current = right[i][3];
            result.depth = Math.max(result.depth, current.depth + 1);
            result.dice = result.dice + current.dice;
            var symbol = right[i][1];
            switch (symbol) {
                case "+":
                    result.value += current.value;
                    result.values.push(...current.values);
                    result.pretties = result.pretties + " + " + current.pretties;
                    break;
                case "-":
                    result.value -= current.value;
                    result.values.push(-current.value);
                    result.pretties = result.pretties + " - " + current.pretties;
                    break;
                case "++":
                    result.value += current.value * result.values.length;
                    result.values = result.values.map(function (val) {
                        return val + current.value;
                    });
                    var prettiesArr = result.values.sort((a, b) => a - b).reverse();
                    var joined = "[" + prettiesArr.join(", ") + "]";
                    result.pretties = joined + " ⟵ " + result.pretties + " ++ " + current.pretties;
                    break;
                case "--":
                    result.value -= current.value * result.values.length;
                    result.values = result.values.map(function (val) {
                        return val - current.value;
                    });
                    var prettiesArr = result.values.sort((a, b) => a - b).reverse();
                    var joined = "[" + prettiesArr.join(", ") + "]";
                    result.pretties = joined + " ⟵ " + result.pretties + " -- " + current.pretties;
                    break;
            }
        }
        return result;
    };
    const peg$c29 = "*";
    const peg$c30 = peg$literalExpectation("*", false);
    const peg$c31 = "/";
    const peg$c32 = peg$literalExpectation("/", false);
    const peg$c33 = function (left, right) {
        var result = left, i;
        for (i = 0; i < right.length; i++) {
            var current = right[i][3];
            result.depth = Math.max(result.depth, current.depth + 1);
            result.dice = result.dice + current.dice;
            if (right[i][1] === "*") {
                result.value *= current.value;
                result.values = result.values.map(function (val) {
                    return val * current.value;
                });
                result.pretties = result.pretties + " \\* " + current.pretties;
            }
            if (right[i][1] === "/") {
                result.value /= current.value;
                result.values = result.values.map(function (val) {
                    return val / current.value;
                });
                result.pretties = result.pretties + " / " + current.pretties;
            }
        }
        return result;
    };
    const peg$c34 = "(";
    const peg$c35 = peg$literalExpectation("(", false);
    const peg$c36 = ")";
    const peg$c37 = peg$literalExpectation(")", false);
    const peg$c38 = function (expr) {
        expr.depth += 1;
        expr.pretties = `( ${expr.pretties} )`;
        return expr;
    };
    const peg$c39 = /^[dD]/;
    const peg$c40 = peg$classExpectation(["d", "D"], false, false);
    const peg$c41 = /^[Ff]/;
    const peg$c42 = peg$classExpectation(["F", "f"], false, false);
    const peg$c43 = function (left) {
        return makeFateRoll(left);
    };
    const peg$c44 = /^[BGW]/;
    const peg$c45 = peg$classExpectation(["B", "G", "W"], false, false);
    const peg$c46 = "!";
    const peg$c47 = peg$literalExpectation("!", false);
    const peg$c48 = function (left, right, explode) {
        let rollLeft = right;
        let rollRight = makeInteger("6");
        let rollResult = makeBasicRoll(rollLeft, rollRight, explode, {});
        let counterRight = makeBurningWheelNumber(left);
        let counterResult = makeCounter(rollResult, ">>", counterRight);
        counterResult.pretties = `${left}${right.pretties} (${counterResult.pretties})`;
        return counterResult;
    };
    const peg$c49 = function (left, right, explodeConfiguration, configuration) {
        return makeBasicRoll(left, right, explodeConfiguration, configuration);
    };
    const peg$c50 = function (value) {
        return {
            operator: "!",
            value: value && value.value || null
        };
    };
    const peg$c51 = "ns";
    const peg$c52 = peg$literalExpectation("ns", false);
    const peg$c53 = function (keepDrop, daro, noSort) {
        const configuration = keepDrop || { operator: null, value: null };
        configuration.noSort = noSort ? true : false;
        configuration.allSameAndExplode = daro ? true : false;
        return configuration;
    };
    const peg$c54 = "daro";
    const peg$c55 = peg$literalExpectation("daro", false);
    const peg$c56 = "aro";
    const peg$c57 = peg$literalExpectation("aro", false);
    const peg$c58 = "taro";
    const peg$c59 = peg$literalExpectation("taro", false);
    const peg$c60 = function (which) {
        return which;
    };
    const peg$c61 = function (which) {
        return which; // these all return something of the format {operator: "kh"|"kl"|"dh"|"dl"|"c", value: integer}
    };
    const peg$c62 = "k";
    const peg$c63 = peg$literalExpectation("k", false);
    const peg$c64 = function (operator, value) {
        return {
            operator: "kh",
            value: value.value,
        };
    };
    const peg$c65 = "kh";
    const peg$c66 = peg$literalExpectation("kh", false);
    const peg$c67 = "kl";
    const peg$c68 = peg$literalExpectation("kl", false);
    const peg$c69 = function (operator, value) {
        return {
            operator: "kl",
            value: value.value,
        };
    };
    const peg$c70 = "d";
    const peg$c71 = peg$literalExpectation("d", false);
    const peg$c72 = function (operator, value) {
        return {
            operator: "dl",
            value: value.value,
        };
    };
    const peg$c73 = "dh";
    const peg$c74 = peg$literalExpectation("dh", false);
    const peg$c75 = function (operator, value) {
        return {
            operator: "dh",
            value: value.value,
        };
    };
    const peg$c76 = "dl";
    const peg$c77 = peg$literalExpectation("dl", false);
    const peg$c78 = "c";
    const peg$c79 = peg$literalExpectation("c", false);
    const peg$c80 = function (operator, value) {
        return {
            operator: "c",
            value: value.value,
        };
    };
    const peg$c81 = peg$otherExpectation("integer");
    const peg$c82 = /^[0-9]/;
    const peg$c83 = peg$classExpectation([["0", "9"]], false, false);
    const peg$c84 = function () {
        return makeInteger(text());
    };
    const peg$c85 = peg$otherExpectation("whitespace");
    const peg$c86 = /^[   \n\r]/;
    const peg$c87 = peg$classExpectation([" ", " ", " ", "\n", "\r"], false, false);
    const peg$c88 = peg$otherExpectation("forced whitespace");
    const peg$c89 = peg$otherExpectation("any characters");
    const peg$c90 = /^[^]/;
    const peg$c91 = peg$classExpectation([], true, false);
    const peg$c92 = function () {
        return text();
    };
    let peg$currPos = 0;
    let peg$savedPos = 0;
    const peg$posDetailsCache = [{ line: 1, column: 1 }];
    let peg$maxFailPos = 0;
    let peg$maxFailExpected = [];
    let peg$silentFails = 0;
    const peg$resultsCache = {};
    let peg$result;
    if (options.startRule !== undefined) {
        if (!(options.startRule in peg$startRuleFunctions)) {
            throw new Error("Can't start parsing from rule \"" + options.startRule + "\".");
        }
        peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
    }
    function text() {
        return input.substring(peg$savedPos, peg$currPos);
    }
    function location() {
        return peg$computeLocation(peg$savedPos, peg$currPos);
    }
    function expected(description, location1) {
        location1 = location1 !== undefined
            ? location1
            : peg$computeLocation(peg$savedPos, peg$currPos);
        throw peg$buildStructuredError([peg$otherExpectation(description)], input.substring(peg$savedPos, peg$currPos), location1);
    }
    function error(message, location1) {
        location1 = location1 !== undefined
            ? location1
            : peg$computeLocation(peg$savedPos, peg$currPos);
        throw peg$buildSimpleError(message, location1);
    }
    function peg$literalExpectation(text1, ignoreCase) {
        return { type: "literal", text: text1, ignoreCase: ignoreCase };
    }
    function peg$classExpectation(parts, inverted, ignoreCase) {
        return { type: "class", parts: parts, inverted: inverted, ignoreCase: ignoreCase };
    }
    function peg$anyExpectation() {
        return { type: "any" };
    }
    function peg$endExpectation() {
        return { type: "end" };
    }
    function peg$otherExpectation(description) {
        return { type: "other", description: description };
    }
    function peg$computePosDetails(pos) {
        let details = peg$posDetailsCache[pos];
        let p;
        if (details) {
            return details;
        }
        else {
            p = pos - 1;
            while (!peg$posDetailsCache[p]) {
                p--;
            }
            details = peg$posDetailsCache[p];
            details = {
                line: details.line,
                column: details.column
            };
            while (p < pos) {
                if (input.charCodeAt(p) === 10) {
                    details.line++;
                    details.column = 1;
                }
                else {
                    details.column++;
                }
                p++;
            }
            peg$posDetailsCache[pos] = details;
            return details;
        }
    }
    function peg$computeLocation(startPos, endPos) {
        const startPosDetails = peg$computePosDetails(startPos);
        const endPosDetails = peg$computePosDetails(endPos);
        return {
            start: {
                offset: startPos,
                line: startPosDetails.line,
                column: startPosDetails.column
            },
            end: {
                offset: endPos,
                line: endPosDetails.line,
                column: endPosDetails.column
            }
        };
    }
    function peg$fail(expected1) {
        if (peg$currPos < peg$maxFailPos) {
            return;
        }
        if (peg$currPos > peg$maxFailPos) {
            peg$maxFailPos = peg$currPos;
            peg$maxFailExpected = [];
        }
        peg$maxFailExpected.push(expected1);
    }
    function peg$buildSimpleError(message, location1) {
        return new SyntaxError(message, [], "", location1);
    }
    function peg$buildStructuredError(expected1, found, location1) {
        return new SyntaxError(SyntaxError.buildMessage(expected1, found), expected1, found, location1);
    }
    function peg$parsestart() {
        let s0, s1, s2;
        const key = peg$currPos * 25 + 0;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        s1 = peg$parseComparator();
        if (s1 !== peg$FAILED) {
            s2 = peg$parseLabel();
            if (s2 === peg$FAILED) {
                s2 = null;
            }
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c0(s1, s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseLabel() {
        let s0, s1, s2;
        const key = peg$currPos * 25 + 1;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        s1 = peg$parse_____();
        if (s1 !== peg$FAILED) {
            s2 = peg$parseGarbage();
            if (s2 === peg$FAILED) {
                s2 = null;
            }
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c1(s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseComparator() {
        let s0, s1, s2, s3, s4, s5;
        const key = peg$currPos * 25 + 2;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        s1 = peg$parseCounter();
        if (s1 !== peg$FAILED) {
            s2 = peg$parse_();
            if (s2 !== peg$FAILED) {
                if (input.substr(peg$currPos, 2) === peg$c2) {
                    s3 = peg$c2;
                    peg$currPos += 2;
                }
                else {
                    s3 = peg$FAILED;
                    if (peg$silentFails === 0) {
                        peg$fail(peg$c3);
                    }
                }
                if (s3 === peg$FAILED) {
                    if (input.substr(peg$currPos, 2) === peg$c4) {
                        s3 = peg$c4;
                        peg$currPos += 2;
                    }
                    else {
                        s3 = peg$FAILED;
                        if (peg$silentFails === 0) {
                            peg$fail(peg$c5);
                        }
                    }
                    if (s3 === peg$FAILED) {
                        if (input.substr(peg$currPos, 2) === peg$c6) {
                            s3 = peg$c6;
                            peg$currPos += 2;
                        }
                        else {
                            s3 = peg$FAILED;
                            if (peg$silentFails === 0) {
                                peg$fail(peg$c7);
                            }
                        }
                        if (s3 === peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 61) {
                                s3 = peg$c8;
                                peg$currPos++;
                            }
                            else {
                                s3 = peg$FAILED;
                                if (peg$silentFails === 0) {
                                    peg$fail(peg$c9);
                                }
                            }
                            if (s3 === peg$FAILED) {
                                if (input.charCodeAt(peg$currPos) === 60) {
                                    s3 = peg$c10;
                                    peg$currPos++;
                                }
                                else {
                                    s3 = peg$FAILED;
                                    if (peg$silentFails === 0) {
                                        peg$fail(peg$c11);
                                    }
                                }
                                if (s3 === peg$FAILED) {
                                    if (input.charCodeAt(peg$currPos) === 62) {
                                        s3 = peg$c12;
                                        peg$currPos++;
                                    }
                                    else {
                                        s3 = peg$FAILED;
                                        if (peg$silentFails === 0) {
                                            peg$fail(peg$c13);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if (s3 !== peg$FAILED) {
                    s4 = peg$parse_();
                    if (s4 !== peg$FAILED) {
                        s5 = peg$parseCounter();
                        if (s5 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c14(s1, s3, s5);
                            s0 = s1;
                        }
                        else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                        }
                    }
                    else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                    }
                }
                else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                }
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
            s0 = peg$parseCounter();
            if (s0 === peg$FAILED) {
                s0 = peg$parseExpression();
            }
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseCounter() {
        let s0, s1, s2, s3, s4, s5;
        const key = peg$currPos * 25 + 3;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        s1 = peg$parseExpression();
        if (s1 !== peg$FAILED) {
            s2 = peg$parse_();
            if (s2 !== peg$FAILED) {
                if (input.substr(peg$currPos, 2) === peg$c15) {
                    s3 = peg$c15;
                    peg$currPos += 2;
                }
                else {
                    s3 = peg$FAILED;
                    if (peg$silentFails === 0) {
                        peg$fail(peg$c16);
                    }
                }
                if (s3 === peg$FAILED) {
                    if (input.substr(peg$currPos, 2) === peg$c17) {
                        s3 = peg$c17;
                        peg$currPos += 2;
                    }
                    else {
                        s3 = peg$FAILED;
                        if (peg$silentFails === 0) {
                            peg$fail(peg$c18);
                        }
                    }
                }
                if (s3 !== peg$FAILED) {
                    s4 = peg$parse_();
                    if (s4 !== peg$FAILED) {
                        s5 = peg$parseExpression();
                        if (s5 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c19(s1, s3, s5);
                            s0 = s1;
                        }
                        else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                        }
                    }
                    else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                    }
                }
                else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                }
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
            s0 = peg$parseExpression();
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseExpression() {
        let s0, s1, s2, s3, s4, s5, s6, s7;
        const key = peg$currPos * 25 + 4;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        s1 = peg$parseTerm();
        if (s1 !== peg$FAILED) {
            s2 = [];
            s3 = peg$currPos;
            s4 = peg$parse_();
            if (s4 !== peg$FAILED) {
                if (input.substr(peg$currPos, 2) === peg$c20) {
                    s5 = peg$c20;
                    peg$currPos += 2;
                }
                else {
                    s5 = peg$FAILED;
                    if (peg$silentFails === 0) {
                        peg$fail(peg$c21);
                    }
                }
                if (s5 === peg$FAILED) {
                    if (input.substr(peg$currPos, 2) === peg$c22) {
                        s5 = peg$c22;
                        peg$currPos += 2;
                    }
                    else {
                        s5 = peg$FAILED;
                        if (peg$silentFails === 0) {
                            peg$fail(peg$c23);
                        }
                    }
                    if (s5 === peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 43) {
                            s5 = peg$c24;
                            peg$currPos++;
                        }
                        else {
                            s5 = peg$FAILED;
                            if (peg$silentFails === 0) {
                                peg$fail(peg$c25);
                            }
                        }
                        if (s5 === peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 45) {
                                s5 = peg$c26;
                                peg$currPos++;
                            }
                            else {
                                s5 = peg$FAILED;
                                if (peg$silentFails === 0) {
                                    peg$fail(peg$c27);
                                }
                            }
                        }
                    }
                }
                if (s5 !== peg$FAILED) {
                    s6 = peg$parse_();
                    if (s6 !== peg$FAILED) {
                        s7 = peg$parseTerm();
                        if (s7 !== peg$FAILED) {
                            s4 = [s4, s5, s6, s7];
                            s3 = s4;
                        }
                        else {
                            peg$currPos = s3;
                            s3 = peg$FAILED;
                        }
                    }
                    else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                    }
                }
                else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                }
            }
            else {
                peg$currPos = s3;
                s3 = peg$FAILED;
            }
            while (s3 !== peg$FAILED) {
                s2.push(s3);
                s3 = peg$currPos;
                s4 = peg$parse_();
                if (s4 !== peg$FAILED) {
                    if (input.substr(peg$currPos, 2) === peg$c20) {
                        s5 = peg$c20;
                        peg$currPos += 2;
                    }
                    else {
                        s5 = peg$FAILED;
                        if (peg$silentFails === 0) {
                            peg$fail(peg$c21);
                        }
                    }
                    if (s5 === peg$FAILED) {
                        if (input.substr(peg$currPos, 2) === peg$c22) {
                            s5 = peg$c22;
                            peg$currPos += 2;
                        }
                        else {
                            s5 = peg$FAILED;
                            if (peg$silentFails === 0) {
                                peg$fail(peg$c23);
                            }
                        }
                        if (s5 === peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 43) {
                                s5 = peg$c24;
                                peg$currPos++;
                            }
                            else {
                                s5 = peg$FAILED;
                                if (peg$silentFails === 0) {
                                    peg$fail(peg$c25);
                                }
                            }
                            if (s5 === peg$FAILED) {
                                if (input.charCodeAt(peg$currPos) === 45) {
                                    s5 = peg$c26;
                                    peg$currPos++;
                                }
                                else {
                                    s5 = peg$FAILED;
                                    if (peg$silentFails === 0) {
                                        peg$fail(peg$c27);
                                    }
                                }
                            }
                        }
                    }
                    if (s5 !== peg$FAILED) {
                        s6 = peg$parse_();
                        if (s6 !== peg$FAILED) {
                            s7 = peg$parseTerm();
                            if (s7 !== peg$FAILED) {
                                s4 = [s4, s5, s6, s7];
                                s3 = s4;
                            }
                            else {
                                peg$currPos = s3;
                                s3 = peg$FAILED;
                            }
                        }
                        else {
                            peg$currPos = s3;
                            s3 = peg$FAILED;
                        }
                    }
                    else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                    }
                }
                else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                }
            }
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c28(s1, s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseTerm() {
        let s0, s1, s2, s3, s4, s5, s6, s7;
        const key = peg$currPos * 25 + 5;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        s1 = peg$parseFactor();
        if (s1 !== peg$FAILED) {
            s2 = [];
            s3 = peg$currPos;
            s4 = peg$parse_();
            if (s4 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 42) {
                    s5 = peg$c29;
                    peg$currPos++;
                }
                else {
                    s5 = peg$FAILED;
                    if (peg$silentFails === 0) {
                        peg$fail(peg$c30);
                    }
                }
                if (s5 === peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 47) {
                        s5 = peg$c31;
                        peg$currPos++;
                    }
                    else {
                        s5 = peg$FAILED;
                        if (peg$silentFails === 0) {
                            peg$fail(peg$c32);
                        }
                    }
                }
                if (s5 !== peg$FAILED) {
                    s6 = peg$parse_();
                    if (s6 !== peg$FAILED) {
                        s7 = peg$parseFactor();
                        if (s7 !== peg$FAILED) {
                            s4 = [s4, s5, s6, s7];
                            s3 = s4;
                        }
                        else {
                            peg$currPos = s3;
                            s3 = peg$FAILED;
                        }
                    }
                    else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                    }
                }
                else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                }
            }
            else {
                peg$currPos = s3;
                s3 = peg$FAILED;
            }
            while (s3 !== peg$FAILED) {
                s2.push(s3);
                s3 = peg$currPos;
                s4 = peg$parse_();
                if (s4 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 42) {
                        s5 = peg$c29;
                        peg$currPos++;
                    }
                    else {
                        s5 = peg$FAILED;
                        if (peg$silentFails === 0) {
                            peg$fail(peg$c30);
                        }
                    }
                    if (s5 === peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 47) {
                            s5 = peg$c31;
                            peg$currPos++;
                        }
                        else {
                            s5 = peg$FAILED;
                            if (peg$silentFails === 0) {
                                peg$fail(peg$c32);
                            }
                        }
                    }
                    if (s5 !== peg$FAILED) {
                        s6 = peg$parse_();
                        if (s6 !== peg$FAILED) {
                            s7 = peg$parseFactor();
                            if (s7 !== peg$FAILED) {
                                s4 = [s4, s5, s6, s7];
                                s3 = s4;
                            }
                            else {
                                peg$currPos = s3;
                                s3 = peg$FAILED;
                            }
                        }
                        else {
                            peg$currPos = s3;
                            s3 = peg$FAILED;
                        }
                    }
                    else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                    }
                }
                else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                }
            }
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c33(s1, s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseFactor() {
        let s0, s1, s2, s3, s4, s5;
        const key = peg$currPos * 25 + 6;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 40) {
            s1 = peg$c34;
            peg$currPos++;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c35);
            }
        }
        if (s1 !== peg$FAILED) {
            s2 = peg$parse_();
            if (s2 !== peg$FAILED) {
                s3 = peg$parseExpression();
                if (s3 !== peg$FAILED) {
                    s4 = peg$parse_();
                    if (s4 !== peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 41) {
                            s5 = peg$c36;
                            peg$currPos++;
                        }
                        else {
                            s5 = peg$FAILED;
                            if (peg$silentFails === 0) {
                                peg$fail(peg$c37);
                            }
                        }
                        if (s5 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c38(s3);
                            s0 = s1;
                        }
                        else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                        }
                    }
                    else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                    }
                }
                else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                }
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
            s0 = peg$parseBasicRoll();
            if (s0 === peg$FAILED) {
                s0 = peg$parseBurningWheelRoll();
                if (s0 === peg$FAILED) {
                    s0 = peg$parseFateRoll();
                    if (s0 === peg$FAILED) {
                        s0 = peg$parseInteger();
                    }
                }
            }
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseFateRoll() {
        let s0, s1, s2, s3;
        const key = peg$currPos * 25 + 7;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        s1 = peg$parseInteger();
        if (s1 === peg$FAILED) {
            s1 = null;
        }
        if (s1 !== peg$FAILED) {
            if (peg$c39.test(input.charAt(peg$currPos))) {
                s2 = input.charAt(peg$currPos);
                peg$currPos++;
            }
            else {
                s2 = peg$FAILED;
                if (peg$silentFails === 0) {
                    peg$fail(peg$c40);
                }
            }
            if (s2 !== peg$FAILED) {
                if (peg$c41.test(input.charAt(peg$currPos))) {
                    s3 = input.charAt(peg$currPos);
                    peg$currPos++;
                }
                else {
                    s3 = peg$FAILED;
                    if (peg$silentFails === 0) {
                        peg$fail(peg$c42);
                    }
                }
                if (s3 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c43(s1);
                    s0 = s1;
                }
                else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                }
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseBurningWheelRoll() {
        let s0, s1, s2, s3;
        const key = peg$currPos * 25 + 8;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        if (peg$c44.test(input.charAt(peg$currPos))) {
            s1 = input.charAt(peg$currPos);
            peg$currPos++;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c45);
            }
        }
        if (s1 !== peg$FAILED) {
            s2 = peg$parseInteger();
            if (s2 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 33) {
                    s3 = peg$c46;
                    peg$currPos++;
                }
                else {
                    s3 = peg$FAILED;
                    if (peg$silentFails === 0) {
                        peg$fail(peg$c47);
                    }
                }
                if (s3 === peg$FAILED) {
                    s3 = null;
                }
                if (s3 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c48(s1, s2, s3);
                    s0 = s1;
                }
                else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                }
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseBasicRoll() {
        let s0, s1, s2, s3, s4, s5;
        const key = peg$currPos * 25 + 9;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        s1 = peg$parseInteger();
        if (s1 === peg$FAILED) {
            s1 = null;
        }
        if (s1 !== peg$FAILED) {
            if (peg$c39.test(input.charAt(peg$currPos))) {
                s2 = input.charAt(peg$currPos);
                peg$currPos++;
            }
            else {
                s2 = peg$FAILED;
                if (peg$silentFails === 0) {
                    peg$fail(peg$c40);
                }
            }
            if (s2 !== peg$FAILED) {
                s3 = peg$parseInteger();
                if (s3 !== peg$FAILED) {
                    s4 = peg$parseExplodeConfiguration();
                    if (s4 === peg$FAILED) {
                        s4 = null;
                    }
                    if (s4 !== peg$FAILED) {
                        s5 = peg$parseBasicRollConfiguration();
                        if (s5 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c49(s1, s3, s4, s5);
                            s0 = s1;
                        }
                        else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                        }
                    }
                    else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                    }
                }
                else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                }
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseExplodeConfiguration() {
        let s0, s1, s2;
        const key = peg$currPos * 25 + 10;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 33) {
            s1 = peg$c46;
            peg$currPos++;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c47);
            }
        }
        if (s1 !== peg$FAILED) {
            s2 = peg$parseInteger();
            if (s2 === peg$FAILED) {
                s2 = null;
            }
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c50(s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseBasicRollConfiguration() {
        let s0, s1, s2, s3;
        const key = peg$currPos * 25 + 11;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        s1 = peg$parseKeepDropConfiguration();
        if (s1 === peg$FAILED) {
            s1 = null;
        }
        if (s1 !== peg$FAILED) {
            s2 = peg$parseTunnelsAndTrollsConfiguration();
            if (s2 === peg$FAILED) {
                s2 = null;
            }
            if (s2 !== peg$FAILED) {
                if (input.substr(peg$currPos, 2) === peg$c51) {
                    s3 = peg$c51;
                    peg$currPos += 2;
                }
                else {
                    s3 = peg$FAILED;
                    if (peg$silentFails === 0) {
                        peg$fail(peg$c52);
                    }
                }
                if (s3 === peg$FAILED) {
                    s3 = null;
                }
                if (s3 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c53(s1, s2, s3);
                    s0 = s1;
                }
                else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                }
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseTunnelsAndTrollsConfiguration() {
        let s0, s1;
        const key = peg$currPos * 25 + 12;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 4) === peg$c54) {
            s1 = peg$c54;
            peg$currPos += 4;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c55);
            }
        }
        if (s1 === peg$FAILED) {
            if (input.substr(peg$currPos, 3) === peg$c56) {
                s1 = peg$c56;
                peg$currPos += 3;
            }
            else {
                s1 = peg$FAILED;
                if (peg$silentFails === 0) {
                    peg$fail(peg$c57);
                }
            }
            if (s1 === peg$FAILED) {
                if (input.substr(peg$currPos, 4) === peg$c58) {
                    s1 = peg$c58;
                    peg$currPos += 4;
                }
                else {
                    s1 = peg$FAILED;
                    if (peg$silentFails === 0) {
                        peg$fail(peg$c59);
                    }
                }
            }
        }
        if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c60(s1);
        }
        s0 = s1;
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseKeepDropConfiguration() {
        let s0, s1;
        const key = peg$currPos * 25 + 13;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        s1 = peg$parseKeepConfiguration();
        if (s1 === peg$FAILED) {
            s1 = peg$parseDropConfiguration();
            if (s1 === peg$FAILED) {
                s1 = peg$parseKeepHighestConfiguration();
                if (s1 === peg$FAILED) {
                    s1 = peg$parseKeepLowestConfiguration();
                    if (s1 === peg$FAILED) {
                        s1 = peg$parseDropHighestConfiguration();
                        if (s1 === peg$FAILED) {
                            s1 = peg$parseDropLowestConfiguration();
                            if (s1 === peg$FAILED) {
                                s1 = peg$parseCritrangeconfiguration();
                            }
                        }
                    }
                }
            }
        }
        if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c61(s1);
        }
        s0 = s1;
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseKeepConfiguration() {
        let s0, s1, s2;
        const key = peg$currPos * 25 + 14;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 107) {
            s1 = peg$c62;
            peg$currPos++;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c63);
            }
        }
        if (s1 !== peg$FAILED) {
            s2 = peg$parseInteger();
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c64(s1, s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseKeepHighestConfiguration() {
        let s0, s1, s2;
        const key = peg$currPos * 25 + 15;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 2) === peg$c65) {
            s1 = peg$c65;
            peg$currPos += 2;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c66);
            }
        }
        if (s1 !== peg$FAILED) {
            s2 = peg$parseInteger();
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c64(s1, s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseKeepLowestConfiguration() {
        let s0, s1, s2;
        const key = peg$currPos * 25 + 16;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 2) === peg$c67) {
            s1 = peg$c67;
            peg$currPos += 2;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c68);
            }
        }
        if (s1 !== peg$FAILED) {
            s2 = peg$parseInteger();
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c69(s1, s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseDropConfiguration() {
        let s0, s1, s2;
        const key = peg$currPos * 25 + 17;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 100) {
            s1 = peg$c70;
            peg$currPos++;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c71);
            }
        }
        if (s1 !== peg$FAILED) {
            s2 = peg$parseInteger();
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c72(s1, s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseDropHighestConfiguration() {
        let s0, s1, s2;
        const key = peg$currPos * 25 + 18;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 2) === peg$c73) {
            s1 = peg$c73;
            peg$currPos += 2;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c74);
            }
        }
        if (s1 !== peg$FAILED) {
            s2 = peg$parseInteger();
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c75(s1, s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseDropLowestConfiguration() {
        let s0, s1, s2;
        const key = peg$currPos * 25 + 19;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 2) === peg$c76) {
            s1 = peg$c76;
            peg$currPos += 2;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c77);
            }
        }
        if (s1 !== peg$FAILED) {
            s2 = peg$parseInteger();
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c72(s1, s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseCritrangeconfiguration() {
        let s0, s1, s2;
        const key = peg$currPos * 25 + 20;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 99) {
            s1 = peg$c78;
            peg$currPos++;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c79);
            }
        }
        if (s1 !== peg$FAILED) {
            s2 = peg$parseInteger();
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c80(s1, s2);
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseInteger() {
        let s0, s1, s2, s3;
        const key = peg$currPos * 25 + 21;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        peg$silentFails++;
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 45) {
            s1 = peg$c26;
            peg$currPos++;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c27);
            }
        }
        if (s1 === peg$FAILED) {
            s1 = null;
        }
        if (s1 !== peg$FAILED) {
            s2 = [];
            if (peg$c82.test(input.charAt(peg$currPos))) {
                s3 = input.charAt(peg$currPos);
                peg$currPos++;
            }
            else {
                s3 = peg$FAILED;
                if (peg$silentFails === 0) {
                    peg$fail(peg$c83);
                }
            }
            if (s3 !== peg$FAILED) {
                while (s3 !== peg$FAILED) {
                    s2.push(s3);
                    if (peg$c82.test(input.charAt(peg$currPos))) {
                        s3 = input.charAt(peg$currPos);
                        peg$currPos++;
                    }
                    else {
                        s3 = peg$FAILED;
                        if (peg$silentFails === 0) {
                            peg$fail(peg$c83);
                        }
                    }
                }
            }
            else {
                s2 = peg$FAILED;
            }
            if (s2 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c84();
                s0 = s1;
            }
            else {
                peg$currPos = s0;
                s0 = peg$FAILED;
            }
        }
        else {
            peg$currPos = s0;
            s0 = peg$FAILED;
        }
        peg$silentFails--;
        if (s0 === peg$FAILED) {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c81);
            }
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parse_() {
        let s0, s1;
        const key = peg$currPos * 25 + 22;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        peg$silentFails++;
        s0 = [];
        if (peg$c86.test(input.charAt(peg$currPos))) {
            s1 = input.charAt(peg$currPos);
            peg$currPos++;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c87);
            }
        }
        while (s1 !== peg$FAILED) {
            s0.push(s1);
            if (peg$c86.test(input.charAt(peg$currPos))) {
                s1 = input.charAt(peg$currPos);
                peg$currPos++;
            }
            else {
                s1 = peg$FAILED;
                if (peg$silentFails === 0) {
                    peg$fail(peg$c87);
                }
            }
        }
        peg$silentFails--;
        if (s0 === peg$FAILED) {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c85);
            }
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parse_____() {
        let s0, s1;
        const key = peg$currPos * 25 + 23;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        peg$silentFails++;
        s0 = [];
        if (peg$c86.test(input.charAt(peg$currPos))) {
            s1 = input.charAt(peg$currPos);
            peg$currPos++;
        }
        else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c87);
            }
        }
        if (s1 !== peg$FAILED) {
            while (s1 !== peg$FAILED) {
                s0.push(s1);
                if (peg$c86.test(input.charAt(peg$currPos))) {
                    s1 = input.charAt(peg$currPos);
                    peg$currPos++;
                }
                else {
                    s1 = peg$FAILED;
                    if (peg$silentFails === 0) {
                        peg$fail(peg$c87);
                    }
                }
            }
        }
        else {
            s0 = peg$FAILED;
        }
        peg$silentFails--;
        if (s0 === peg$FAILED) {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c88);
            }
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    function peg$parseGarbage() {
        let s0, s1, s2;
        const key = peg$currPos * 25 + 24;
        const cached = peg$resultsCache[key];
        if (cached) {
            peg$currPos = cached.nextPos;
            return cached.result;
        }
        peg$silentFails++;
        s0 = peg$currPos;
        s1 = [];
        if (peg$c90.test(input.charAt(peg$currPos))) {
            s2 = input.charAt(peg$currPos);
            peg$currPos++;
        }
        else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c91);
            }
        }
        while (s2 !== peg$FAILED) {
            s1.push(s2);
            if (peg$c90.test(input.charAt(peg$currPos))) {
                s2 = input.charAt(peg$currPos);
                peg$currPos++;
            }
            else {
                s2 = peg$FAILED;
                if (peg$silentFails === 0) {
                    peg$fail(peg$c91);
                }
            }
        }
        if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c92();
        }
        s0 = s1;
        peg$silentFails--;
        if (s0 === peg$FAILED) {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
                peg$fail(peg$c89);
            }
        }
        peg$resultsCache[key] = { nextPos: peg$currPos, result: s0 };
        return s0;
    }
    // see ./rollem-header.ts and gulpfile.js for how imports are handled
    peg$result = peg$startRuleFunction();
    if (peg$result !== peg$FAILED && peg$currPos === input.length) {
        return peg$result;
    }
    else {
        if (peg$result !== peg$FAILED && peg$currPos < input.length) {
            peg$fail(peg$endExpectation());
        }
        throw peg$buildStructuredError(peg$maxFailExpected, peg$maxFailPos < input.length ? input.charAt(peg$maxFailPos) : null, peg$maxFailPos < input.length
            ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1)
            : peg$computeLocation(peg$maxFailPos, peg$maxFailPos));
    }
}
exports.parse = peg$parse;
