(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(global = global || self, factory(global.window = global.window || {}));
}(this, (function (exports) { 'use strict';

	var emojiExp = /([\uD800-\uDBFF][\uDC00-\uDFFF](?:[\u200D\uFE0F][\uD800-\uDBFF][\uDC00-\uDFFF]){2,}|\uD83D\uDC69(?:\u200D(?:(?:\uD83D\uDC69\u200D)?\uD83D\uDC67|(?:\uD83D\uDC69\u200D)?\uD83D\uDC66)|\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC69\u200D(?:\uD83D\uDC69\u200D)?\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC69\u200D(?:\uD83D\uDC69\u200D)?\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD37-\uDD39\uDD3D\uDD3E\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]\uFE0F|\uD83D\uDC69(?:\uD83C[\uDFFB-\uDFFF])\u200D(?:\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92])|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC6F\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD37-\uDD39\uDD3C-\uDD3E\uDDD6-\uDDDF])\u200D[\u2640\u2642]\uFE0F|\uD83C\uDDFD\uD83C\uDDF0|\uD83C\uDDF6\uD83C\uDDE6|\uD83C\uDDF4\uD83C\uDDF2|\uD83C\uDDE9(?:\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF])|\uD83C\uDDF7(?:\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC])|\uD83C\uDDE8(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF5\uDDF7\uDDFA-\uDDFF])|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uFE0F\u200D[\u2640\u2642]|(?:\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642])\uFE0F|(?:\uD83D\uDC41\uFE0F\u200D\uD83D\uDDE8|\uD83D\uDC69(?:\uD83C[\uDFFB-\uDFFF])\u200D[\u2695\u2696\u2708]|\uD83D\uDC69\u200D[\u2695\u2696\u2708]|\uD83D\uDC68(?:(?:\uD83C[\uDFFB-\uDFFF])\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708]))\uFE0F|\uD83C\uDDF2(?:\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF])|\uD83D\uDC69\u200D(?:\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69]))|\uD83C\uDDF1(?:\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE])|\uD83C\uDDEF(?:\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5])|\uD83C\uDDED(?:\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA])|\uD83C\uDDEB(?:\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7])|[#\*0-9]\uFE0F\u20E3|\uD83C\uDDE7(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF])|\uD83C\uDDE6(?:\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF])|\uD83C\uDDFF(?:\uD83C[\uDDE6\uDDF2\uDDFC])|\uD83C\uDDF5(?:\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE])|\uD83C\uDDFB(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA])|\uD83C\uDDF3(?:\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF])|\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62(?:\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73|\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74|\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67)\uDB40\uDC7F|\uD83D\uDC68(?:\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83D\uDC68|(?:(?:\uD83D[\uDC68\uDC69])\u200D)?\uD83D\uDC66\u200D\uD83D\uDC66|(?:(?:\uD83D[\uDC68\uDC69])\u200D)?\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92])|(?:\uD83C[\uDFFB-\uDFFF])\u200D(?:\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]))|\uD83C\uDDF8(?:\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF])|\uD83C\uDDF0(?:\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF])|\uD83C\uDDFE(?:\uD83C[\uDDEA\uDDF9])|\uD83C\uDDEE(?:\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9])|\uD83C\uDDF9(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF])|\uD83C\uDDEC(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE])|\uD83C\uDDFA(?:\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF])|\uD83C\uDDEA(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA])|\uD83C\uDDFC(?:\uD83C[\uDDEB\uDDF8])|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uD83C[\uDFFB-\uDFFF])|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD37-\uDD39\uDD3D\uDD3E\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u261D\u270A-\u270D]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC70\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDCAA\uDD74\uDD7A\uDD90\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD36\uDDD1-\uDDD5])(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC68(?:\u200D(?:(?:(?:\uD83D[\uDC68\uDC69])\u200D)?\uD83D\uDC67|(?:(?:\uD83D[\uDC68\uDC69])\u200D)?\uD83D\uDC66)|\uD83C[\uDFFB-\uDFFF])|(?:[\u261D\u26F9\u270A-\u270D]|\uD83C[\uDF85\uDFC2-\uDFC4\uDFC7\uDFCA-\uDFCC]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66-\uDC69\uDC6E\uDC70-\uDC78\uDC7C\uDC81-\uDC83\uDC85-\uDC87\uDCAA\uDD74\uDD75\uDD7A\uDD90\uDD95\uDD96\uDE45-\uDE47\uDE4B-\uDE4F\uDEA3\uDEB4-\uDEB6\uDEC0\uDECC]|\uD83E[\uDD18-\uDD1C\uDD1E\uDD1F\uDD26\uDD30-\uDD39\uDD3D\uDD3E\uDDD1-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])?|(?:[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF93\uDFA0-\uDFCA\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF4\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC3E\uDC40\uDC42-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDD7A\uDD95\uDD96\uDDA4\uDDFB-\uDE4F\uDE80-\uDEC5\uDECC\uDED0-\uDED2\uDEEB\uDEEC\uDEF4-\uDEF8]|\uD83E[\uDD10-\uDD3A\uDD3C-\uDD3E\uDD40-\uDD45\uDD47-\uDD4C\uDD50-\uDD6B\uDD80-\uDD97\uDDC0\uDDD0-\uDDE6])|(?:[#\*0-9\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u2660\u2663\u2665\u2666\u2668\u267B\u267F\u2692-\u2697\u2699\u269B\u269C\u26A0\u26A1\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|\uD83C[\uDC04\uDCCF\uDD70\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDF21\uDF24-\uDF93\uDF96\uDF97\uDF99-\uDF9B\uDF9E-\uDFF0\uDFF3-\uDFF5\uDFF7-\uDFFF]|\uD83D[\uDC00-\uDCFD\uDCFF-\uDD3D\uDD49-\uDD4E\uDD50-\uDD67\uDD6F\uDD70\uDD73-\uDD7A\uDD87\uDD8A-\uDD8D\uDD90\uDD95\uDD96\uDDA4\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA-\uDE4F\uDE80-\uDEC5\uDECB-\uDED2\uDEE0-\uDEE5\uDEE9\uDEEB\uDEEC\uDEF0\uDEF3-\uDEF8]|\uD83E[\uDD10-\uDD3A\uDD3C-\uDD3E\uDD40-\uDD45\uDD47-\uDD4C\uDD50-\uDD6B\uDD80-\uDD97\uDDC0\uDDD0-\uDDE6])\uFE0F)/;
	function getText(e) {
	  var type = e.nodeType,
	      result = "";

	  if (type === 1 || type === 9 || type === 11) {
	    if (typeof e.textContent === "string") {
	      return e.textContent;
	    } else {
	      for (e = e.firstChild; e; e = e.nextSibling) {
	        result += getText(e);
	      }
	    }
	  } else if (type === 3 || type === 4) {
	    return e.nodeValue;
	  }

	  return result;
	}

	/*!
	 * SplitText: 3.12.2
	 * https://greensock.com
	 *
	 * @license Copyright 2008-2023, GreenSock. All rights reserved.
	 * Subject to the terms at https://greensock.com/standard-license or for
	 * Club GreenSock members, the agreement issued with that membership.
	 * @author: Jack Doyle, jack@greensock.com
	*/

	var _doc,
	    _win,
	    _coreInitted,
	    gsap,
	    _context,
	    _toArray,
	    _stripExp = /(?:\r|\n|\t\t)/g,
	    _multipleSpacesExp = /(?:\s\s+)/g,
	    _initCore = function _initCore(core) {
	  _doc = document;
	  _win = window;
	  gsap = gsap || core || _win.gsap || console.warn("Please gsap.registerPlugin(SplitText)");

	  if (gsap) {
	    _toArray = gsap.utils.toArray;

	    _context = gsap.core.context || function () {};

	    _coreInitted = 1;
	  }
	},
	    _getComputedStyle = function _getComputedStyle(element) {
	  return _win.getComputedStyle(element);
	},
	    _isAbsolute = function _isAbsolute(vars) {
	  return vars.position === "absolute" || vars.absolute === true;
	},
	    _findSpecialChars = function _findSpecialChars(text, chars) {
	  var i = chars.length,
	      s;

	  while (--i > -1) {
	    s = chars[i];

	    if (text.substr(0, s.length) === s) {
	      return s.length;
	    }
	  }
	},
	    _divStart = " style='position:relative;display:inline-block;'",
	    _cssClassFunc = function _cssClassFunc(cssClass, tag) {
	  if (cssClass === void 0) {
	    cssClass = "";
	  }

	  var iterate = ~cssClass.indexOf("++"),
	      num = 1;

	  if (iterate) {
	    cssClass = cssClass.split("++").join("");
	  }

	  return function () {
	    return "<" + tag + _divStart + (cssClass ? " class='" + cssClass + (iterate ? num++ : "") + "'>" : ">");
	  };
	},
	    _swapText = function _swapText(element, oldText, newText) {
	  var type = element.nodeType;

	  if (type === 1 || type === 9 || type === 11) {
	    for (element = element.firstChild; element; element = element.nextSibling) {
	      _swapText(element, oldText, newText);
	    }
	  } else if (type === 3 || type === 4) {
	    element.nodeValue = element.nodeValue.split(oldText).join(newText);
	  }
	},
	    _pushReversed = function _pushReversed(a, merge) {
	  var i = merge.length;

	  while (--i > -1) {
	    a.push(merge[i]);
	  }
	},
	    _isBeforeWordDelimiter = function _isBeforeWordDelimiter(e, root, wordDelimiter) {
	  var next;

	  while (e && e !== root) {
	    next = e._next || e.nextSibling;

	    if (next) {
	      return next.textContent.charAt(0) === wordDelimiter;
	    }

	    e = e.parentNode || e._parent;
	  }
	},
	    _deWordify = function _deWordify(e) {
	  var children = _toArray(e.childNodes),
	      l = children.length,
	      i,
	      child;

	  for (i = 0; i < l; i++) {
	    child = children[i];

	    if (child._isSplit) {
	      _deWordify(child);
	    } else {
	      if (i && child.previousSibling && child.previousSibling.nodeType === 3) {
	        child.previousSibling.nodeValue += child.nodeType === 3 ? child.nodeValue : child.firstChild.nodeValue;
	        e.removeChild(child);
	      } else if (child.nodeType !== 3) {
	        e.insertBefore(child.firstChild, child);
	        e.removeChild(child);
	      }
	    }
	  }
	},
	    _getStyleAsNumber = function _getStyleAsNumber(name, computedStyle) {
	  return parseFloat(computedStyle[name]) || 0;
	},
	    _setPositionsAfterSplit = function _setPositionsAfterSplit(element, vars, allChars, allWords, allLines, origWidth, origHeight) {
	  var cs = _getComputedStyle(element),
	      paddingLeft = _getStyleAsNumber("paddingLeft", cs),
	      lineOffsetY = -999,
	      borderTopAndBottom = _getStyleAsNumber("borderBottomWidth", cs) + _getStyleAsNumber("borderTopWidth", cs),
	      borderLeftAndRight = _getStyleAsNumber("borderLeftWidth", cs) + _getStyleAsNumber("borderRightWidth", cs),
	      padTopAndBottom = _getStyleAsNumber("paddingTop", cs) + _getStyleAsNumber("paddingBottom", cs),
	      padLeftAndRight = _getStyleAsNumber("paddingLeft", cs) + _getStyleAsNumber("paddingRight", cs),
	      lineThreshold = _getStyleAsNumber("fontSize", cs) * (vars.lineThreshold || 0.2),
	      textAlign = cs.textAlign,
	      charArray = [],
	      wordArray = [],
	      lineArray = [],
	      wordDelimiter = vars.wordDelimiter || " ",
	      tag = vars.tag ? vars.tag : vars.span ? "span" : "div",
	      types = vars.type || vars.split || "chars,words,lines",
	      lines = allLines && ~types.indexOf("lines") ? [] : null,
	      words = ~types.indexOf("words"),
	      chars = ~types.indexOf("chars"),
	      absolute = _isAbsolute(vars),
	      linesClass = vars.linesClass,
	      iterateLine = ~(linesClass || "").indexOf("++"),
	      spaceNodesToRemove = [],
	      isFlex = cs.display === "flex",
	      prevInlineDisplay = element.style.display,
	      i,
	      j,
	      l,
	      node,
	      nodes,
	      isChild,
	      curLine,
	      addWordSpaces,
	      style,
	      lineNode,
	      lineWidth,
	      offset;

	  iterateLine && (linesClass = linesClass.split("++").join(""));
	  isFlex && (element.style.display = "block");
	  j = element.getElementsByTagName("*");
	  l = j.length;
	  nodes = [];

	  for (i = 0; i < l; i++) {
	    nodes[i] = j[i];
	  }

	  if (lines || absolute) {
	    for (i = 0; i < l; i++) {
	      node = nodes[i];
	      isChild = node.parentNode === element;

	      if (isChild || absolute || chars && !words) {
	        offset = node.offsetTop;

	        if (lines && isChild && Math.abs(offset - lineOffsetY) > lineThreshold && (node.nodeName !== "BR" || i === 0)) {
	          curLine = [];
	          lines.push(curLine);
	          lineOffsetY = offset;
	        }

	        if (absolute) {
	          node._x = node.offsetLeft;
	          node._y = offset;
	          node._w = node.offsetWidth;
	          node._h = node.offsetHeight;
	        }

	        if (lines) {
	          if (node._isSplit && isChild || !chars && isChild || words && isChild || !words && node.parentNode.parentNode === element && !node.parentNode._isSplit) {
	            curLine.push(node);
	            node._x -= paddingLeft;

	            if (_isBeforeWordDelimiter(node, element, wordDelimiter)) {
	              node._wordEnd = true;
	            }
	          }

	          if (node.nodeName === "BR" && (node.nextSibling && node.nextSibling.nodeName === "BR" || i === 0)) {
	            lines.push([]);
	          }
	        }
	      }
	    }
	  }

	  for (i = 0; i < l; i++) {
	    node = nodes[i];
	    isChild = node.parentNode === element;

	    if (node.nodeName === "BR") {
	      if (lines || absolute) {
	        node.parentNode && node.parentNode.removeChild(node);
	        nodes.splice(i--, 1);
	        l--;
	      } else if (!words) {
	        element.appendChild(node);
	      }

	      continue;
	    }

	    if (absolute) {
	      style = node.style;

	      if (!words && !isChild) {
	        node._x += node.parentNode._x;
	        node._y += node.parentNode._y;
	      }

	      style.left = node._x + "px";
	      style.top = node._y + "px";
	      style.position = "absolute";
	      style.display = "block";
	      style.width = node._w + 1 + "px";
	      style.height = node._h + "px";
	    }

	    if (!words && chars) {
	      if (node._isSplit) {
	        node._next = j = node.nextSibling;
	        node.parentNode.appendChild(node);

	        while (j && j.nodeType === 3 && j.textContent === " ") {
	          node._next = j.nextSibling;
	          node.parentNode.appendChild(j);
	          j = j.nextSibling;
	        }
	      } else if (node.parentNode._isSplit) {
	        node._parent = node.parentNode;

	        if (!node.previousSibling && node.firstChild) {
	          node.firstChild._isFirst = true;
	        }

	        if (node.nextSibling && node.nextSibling.textContent === " " && !node.nextSibling.nextSibling) {
	          spaceNodesToRemove.push(node.nextSibling);
	        }

	        node._next = node.nextSibling && node.nextSibling._isFirst ? null : node.nextSibling;
	        node.parentNode.removeChild(node);
	        nodes.splice(i--, 1);
	        l--;
	      } else if (!isChild) {
	        offset = !node.nextSibling && _isBeforeWordDelimiter(node.parentNode, element, wordDelimiter);
	        node.parentNode._parent && node.parentNode._parent.appendChild(node);
	        offset && node.parentNode.appendChild(_doc.createTextNode(" "));

	        if (tag === "span") {
	          node.style.display = "inline";
	        }

	        charArray.push(node);
	      }
	    } else if (node.parentNode._isSplit && !node._isSplit && node.innerHTML !== "") {
	      wordArray.push(node);
	    } else if (chars && !node._isSplit) {
	      if (tag === "span") {
	        node.style.display = "inline";
	      }

	      charArray.push(node);
	    }
	  }

	  i = spaceNodesToRemove.length;

	  while (--i > -1) {
	    spaceNodesToRemove[i].parentNode.removeChild(spaceNodesToRemove[i]);
	  }

	  if (lines) {
	    if (absolute) {
	      lineNode = _doc.createElement(tag);
	      element.appendChild(lineNode);
	      lineWidth = lineNode.offsetWidth + "px";
	      offset = lineNode.offsetParent === element ? 0 : element.offsetLeft;
	      element.removeChild(lineNode);
	    }

	    style = element.style.cssText;
	    element.style.cssText = "display:none;";

	    while (element.firstChild) {
	      element.removeChild(element.firstChild);
	    }

	    addWordSpaces = wordDelimiter === " " && (!absolute || !words && !chars);

	    for (i = 0; i < lines.length; i++) {
	      curLine = lines[i];
	      lineNode = _doc.createElement(tag);
	      lineNode.style.cssText = "display:block;text-align:" + textAlign + ";position:" + (absolute ? "absolute;" : "relative;");

	      if (linesClass) {
	        lineNode.className = linesClass + (iterateLine ? i + 1 : "");
	      }

	      lineArray.push(lineNode);
	      l = curLine.length;

	      for (j = 0; j < l; j++) {
	        if (curLine[j].nodeName !== "BR") {
	          node = curLine[j];
	          lineNode.appendChild(node);
	          addWordSpaces && node._wordEnd && lineNode.appendChild(_doc.createTextNode(" "));

	          if (absolute) {
	            if (j === 0) {
	              lineNode.style.top = node._y + "px";
	              lineNode.style.left = paddingLeft + offset + "px";
	            }

	            node.style.top = "0px";

	            if (offset) {
	              node.style.left = node._x - offset + "px";
	            }
	          }
	        }
	      }

	      if (l === 0) {
	        lineNode.innerHTML = "&nbsp;";
	      } else if (!words && !chars) {
	        _deWordify(lineNode);

	        _swapText(lineNode, String.fromCharCode(160), " ");
	      }

	      if (absolute) {
	        lineNode.style.width = lineWidth;
	        lineNode.style.height = node._h + "px";
	      }

	      element.appendChild(lineNode);
	    }

	    element.style.cssText = style;
	  }

	  if (absolute) {
	    if (origHeight > element.clientHeight) {
	      element.style.height = origHeight - padTopAndBottom + "px";

	      if (element.clientHeight < origHeight) {
	        element.style.height = origHeight + borderTopAndBottom + "px";
	      }
	    }

	    if (origWidth > element.clientWidth) {
	      element.style.width = origWidth - padLeftAndRight + "px";

	      if (element.clientWidth < origWidth) {
	        element.style.width = origWidth + borderLeftAndRight + "px";
	      }
	    }
	  }

	  isFlex && (prevInlineDisplay ? element.style.display = prevInlineDisplay : element.style.removeProperty("display"));

	  _pushReversed(allChars, charArray);

	  words && _pushReversed(allWords, wordArray);

	  _pushReversed(allLines, lineArray);
	},
	    _splitRawText = function _splitRawText(element, vars, wordStart, charStart) {
	  var tag = vars.tag ? vars.tag : vars.span ? "span" : "div",
	      types = vars.type || vars.split || "chars,words,lines",
	      chars = ~types.indexOf("chars"),
	      absolute = _isAbsolute(vars),
	      wordDelimiter = vars.wordDelimiter || " ",
	      space = wordDelimiter !== " " ? "" : absolute ? "&#173; " : " ",
	      wordEnd = "</" + tag + ">",
	      wordIsOpen = 1,
	      specialChars = vars.specialChars ? typeof vars.specialChars === "function" ? vars.specialChars : _findSpecialChars : null,
	      text,
	      splitText,
	      i,
	      j,
	      l,
	      character,
	      hasTagStart,
	      testResult,
	      container = _doc.createElement("div"),
	      parent = element.parentNode;

	  parent.insertBefore(container, element);
	  container.textContent = element.nodeValue;
	  parent.removeChild(element);
	  element = container;
	  text = getText(element);
	  hasTagStart = text.indexOf("<") !== -1;

	  if (vars.reduceWhiteSpace !== false) {
	    text = text.replace(_multipleSpacesExp, " ").replace(_stripExp, "");
	  }

	  if (hasTagStart) {
	    text = text.split("<").join("{{LT}}");
	  }

	  l = text.length;
	  splitText = (text.charAt(0) === " " ? space : "") + wordStart();

	  for (i = 0; i < l; i++) {
	    character = text.charAt(i);

	    if (specialChars && (testResult = specialChars(text.substr(i), vars.specialChars))) {
	      character = text.substr(i, testResult || 1);
	      splitText += chars && character !== " " ? charStart() + character + "</" + tag + ">" : character;
	      i += testResult - 1;
	    } else if (character === wordDelimiter && text.charAt(i - 1) !== wordDelimiter && i) {
	      splitText += wordIsOpen ? wordEnd : "";
	      wordIsOpen = 0;

	      while (text.charAt(i + 1) === wordDelimiter) {
	        splitText += space;
	        i++;
	      }

	      if (i === l - 1) {
	        splitText += space;
	      } else if (text.charAt(i + 1) !== ")") {
	        splitText += space + wordStart();
	        wordIsOpen = 1;
	      }
	    } else if (character === "{" && text.substr(i, 6) === "{{LT}}") {
	      splitText += chars ? charStart() + "{{LT}}" + "</" + tag + ">" : "{{LT}}";
	      i += 5;
	    } else if (character.charCodeAt(0) >= 0xD800 && character.charCodeAt(0) <= 0xDBFF || text.charCodeAt(i + 1) >= 0xFE00 && text.charCodeAt(i + 1) <= 0xFE0F) {
	      j = ((text.substr(i, 12).split(emojiExp) || [])[1] || "").length || 2;
	      splitText += chars && character !== " " ? charStart() + text.substr(i, j) + "</" + tag + ">" : text.substr(i, j);
	      i += j - 1;
	    } else {
	      splitText += chars && character !== " " ? charStart() + character + "</" + tag + ">" : character;
	    }
	  }

	  element.outerHTML = splitText + (wordIsOpen ? wordEnd : "");
	  hasTagStart && _swapText(parent, "{{LT}}", "<");
	},
	    _split = function _split(element, vars, wordStart, charStart) {
	  var children = _toArray(element.childNodes),
	      l = children.length,
	      absolute = _isAbsolute(vars),
	      i,
	      child;

	  if (element.nodeType !== 3 || l > 1) {
	    vars.absolute = false;

	    for (i = 0; i < l; i++) {
	      child = children[i];
	      child._next = child._isFirst = child._parent = child._wordEnd = null;

	      if (child.nodeType !== 3 || /\S+/.test(child.nodeValue)) {
	        if (absolute && child.nodeType !== 3 && _getComputedStyle(child).display === "inline") {
	          child.style.display = "inline-block";
	          child.style.position = "relative";
	        }

	        child._isSplit = true;

	        _split(child, vars, wordStart, charStart);
	      }
	    }

	    vars.absolute = absolute;
	    element._isSplit = true;
	    return;
	  }

	  _splitRawText(element, vars, wordStart, charStart);
	};

	var SplitText = function () {
	  function SplitText(element, vars) {
	    _coreInitted || _initCore();
	    this.elements = _toArray(element);
	    this.chars = [];
	    this.words = [];
	    this.lines = [];
	    this._originals = [];
	    this.vars = vars || {};

	    _context(this);

	     this.split(vars);
	  }

	  var _proto = SplitText.prototype;

	  _proto.split = function split(vars) {
	    this.isSplit && this.revert();
	    this.vars = vars = vars || this.vars;
	    this._originals.length = this.chars.length = this.words.length = this.lines.length = 0;

	    var i = this.elements.length,
	        tag = vars.tag ? vars.tag : vars.span ? "span" : "div",
	        wordStart = _cssClassFunc(vars.wordsClass, tag),
	        charStart = _cssClassFunc(vars.charsClass, tag),
	        origHeight,
	        origWidth,
	        e;

	    while (--i > -1) {
	      e = this.elements[i];
	      this._originals[i] = e.innerHTML;
	      origHeight = e.clientHeight;
	      origWidth = e.clientWidth;

	      _split(e, vars, wordStart, charStart);

	      _setPositionsAfterSplit(e, vars, this.chars, this.words, this.lines, origWidth, origHeight);
	    }

	    this.chars.reverse();
	    this.words.reverse();
	    this.lines.reverse();
	    this.isSplit = true;
	    return this;
	  };

	  _proto.revert = function revert() {
	    var originals = this._originals;

	    if (!originals) {
	      throw "revert() call wasn't scoped properly.";
	    }

	    this.elements.forEach(function (e, i) {
	      return e.innerHTML = originals[i];
	    });
	    this.chars = [];
	    this.words = [];
	    this.lines = [];
	    this.isSplit = false;
	    return this;
	  };

	  SplitText.create = function create(element, vars) {
	    return new SplitText(element, vars);
	  };

	  return SplitText;
	}();
	SplitText.version = "3.12.2";
	SplitText.register = _initCore;

	exports.SplitText = SplitText;
	exports.default = SplitText;

	Object.defineProperty(exports, '__esModule', { value: true });

})));
