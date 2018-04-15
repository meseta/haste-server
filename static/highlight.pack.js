/*! highlight.js v9.12.0 | BSD3 License | git.io/hljslicense */
(function(factory) {

  // Find the global object for export to both the browser and web workers.
  var globalObject = typeof window === 'object' && window ||
                     typeof self === 'object' && self;

  // Setup highlight.js for different environments. First is Node.js or
  // CommonJS.
  if(typeof exports !== 'undefined') {
    factory(exports);
  } else if(globalObject) {
    // Export hljs globally even when using AMD for cases when this script
    // is loaded with others that may still expect a global hljs.
    globalObject.hljs = factory({});

    // Finally register the global hljs with AMD.
    if(typeof define === 'function' && define.amd) {
      define([], function() {
        return globalObject.hljs;
      });
    }
  }

}(function(hljs) {
  // Convenience variables for build-in objects
  var ArrayProto = [],
      objectKeys = Object.keys;

  // Global internal variables used within the highlight.js library.
  var languages = {},
      aliases   = {};

  // Regular expressions used throughout the highlight.js library.
  var noHighlightRe    = /^(no-?highlight|plain|text)$/i,
      languagePrefixRe = /\blang(?:uage)?-([\w-]+)\b/i,
      fixMarkupRe      = /((^(<[^>]+>|\t|)+|(?:\n)))/gm;

  var spanEndTag = '</span>';

  // Global options used when within external APIs. This is modified when
  // calling the `hljs.configure` function.
  var options = {
    classPrefix: 'hljs-',
    tabReplace: null,
    useBR: false,
    languages: undefined
  };


  /* Utility functions */

  function escape(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function tag(node) {
    return node.nodeName.toLowerCase();
  }

  function testRe(re, lexeme) {
    var match = re && re.exec(lexeme);
    return match && match.index === 0;
  }

  function isNotHighlighted(language) {
    return noHighlightRe.test(language);
  }

  function blockLanguage(block) {
    var i, match, length, _class;
    var classes = block.className + ' ';

    classes += block.parentNode ? block.parentNode.className : '';

    // language-* takes precedence over non-prefixed class names.
    match = languagePrefixRe.exec(classes);
    if (match) {
      return getLanguage(match[1]) ? match[1] : 'no-highlight';
    }

    classes = classes.split(/\s+/);

    for (i = 0, length = classes.length; i < length; i++) {
      _class = classes[i]

      if (isNotHighlighted(_class) || getLanguage(_class)) {
        return _class;
      }
    }
  }

  function inherit(parent) {  // inherit(parent, override_obj, override_obj, ...)
    var key;
    var result = {};
    var objects = Array.prototype.slice.call(arguments, 1);

    for (key in parent)
      result[key] = parent[key];
    objects.forEach(function(obj) {
      for (key in obj)
        result[key] = obj[key];
    });
    return result;
  }

  /* Stream merging */

  function nodeStream(node) {
    var result = [];
    (function _nodeStream(node, offset) {
      for (var child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3)
          offset += child.nodeValue.length;
        else if (child.nodeType === 1) {
          result.push({
            event: 'start',
            offset: offset,
            node: child
          });
          offset = _nodeStream(child, offset);
          // Prevent void elements from having an end tag that would actually
          // double them in the output. There are more void elements in HTML
          // but we list only those realistically expected in code display.
          if (!tag(child).match(/br|hr|img|input/)) {
            result.push({
              event: 'stop',
              offset: offset,
              node: child
            });
          }
        }
      }
      return offset;
    })(node, 0);
    return result;
  }

  function mergeStreams(original, highlighted, value) {
    var processed = 0;
    var result = '';
    var nodeStack = [];

    function selectStream() {
      if (!original.length || !highlighted.length) {
        return original.length ? original : highlighted;
      }
      if (original[0].offset !== highlighted[0].offset) {
        return (original[0].offset < highlighted[0].offset) ? original : highlighted;
      }

      /*
      To avoid starting the stream just before it should stop the order is
      ensured that original always starts first and closes last:

      if (event1 == 'start' && event2 == 'start')
        return original;
      if (event1 == 'start' && event2 == 'stop')
        return highlighted;
      if (event1 == 'stop' && event2 == 'start')
        return original;
      if (event1 == 'stop' && event2 == 'stop')
        return highlighted;

      ... which is collapsed to:
      */
      return highlighted[0].event === 'start' ? original : highlighted;
    }

    function open(node) {
      function attr_str(a) {return ' ' + a.nodeName + '="' + escape(a.value).replace('"', '&quot;') + '"';}
      result += '<' + tag(node) + ArrayProto.map.call(node.attributes, attr_str).join('') + '>';
    }

    function close(node) {
      result += '</' + tag(node) + '>';
    }

    function render(event) {
      (event.event === 'start' ? open : close)(event.node);
    }

    while (original.length || highlighted.length) {
      var stream = selectStream();
      result += escape(value.substring(processed, stream[0].offset));
      processed = stream[0].offset;
      if (stream === original) {
        /*
        On any opening or closing tag of the original markup we first close
        the entire highlighted node stack, then render the original tag along
        with all the following original tags at the same offset and then
        reopen all the tags on the highlighted stack.
        */
        nodeStack.reverse().forEach(close);
        do {
          render(stream.splice(0, 1)[0]);
          stream = selectStream();
        } while (stream === original && stream.length && stream[0].offset === processed);
        nodeStack.reverse().forEach(open);
      } else {
        if (stream[0].event === 'start') {
          nodeStack.push(stream[0].node);
        } else {
          nodeStack.pop();
        }
        render(stream.splice(0, 1)[0]);
      }
    }
    return result + escape(value.substr(processed));
  }

  /* Initialization */

  function expand_mode(mode) {
    if (mode.variants && !mode.cached_variants) {
      mode.cached_variants = mode.variants.map(function(variant) {
        return inherit(mode, {variants: null}, variant);
      });
    }
    return mode.cached_variants || (mode.endsWithParent && [inherit(mode)]) || [mode];
  }

  function compileLanguage(language) {

    function reStr(re) {
        return (re && re.source) || re;
    }

    function langRe(value, global) {
      return new RegExp(
        reStr(value),
        'm' + (language.case_insensitive ? 'i' : '') + (global ? 'g' : '')
      );
    }

    function compileMode(mode, parent) {
      if (mode.compiled)
        return;
      mode.compiled = true;

      mode.keywords = mode.keywords || mode.beginKeywords;
      if (mode.keywords) {
        var compiled_keywords = {};

        var flatten = function(className, str) {
          if (language.case_insensitive) {
            str = str.toLowerCase();
          }
          str.split(' ').forEach(function(kw) {
            var pair = kw.split('|');
            compiled_keywords[pair[0]] = [className, pair[1] ? Number(pair[1]) : 1];
          });
        };

        if (typeof mode.keywords === 'string') { // string
          flatten('keyword', mode.keywords);
        } else {
          objectKeys(mode.keywords).forEach(function (className) {
            flatten(className, mode.keywords[className]);
          });
        }
        mode.keywords = compiled_keywords;
      }
      mode.lexemesRe = langRe(mode.lexemes || /\w+/, true);

      if (parent) {
        if (mode.beginKeywords) {
          mode.begin = '\\b(' + mode.beginKeywords.split(' ').join('|') + ')\\b';
        }
        if (!mode.begin)
          mode.begin = /\B|\b/;
        mode.beginRe = langRe(mode.begin);
        if (!mode.end && !mode.endsWithParent)
          mode.end = /\B|\b/;
        if (mode.end)
          mode.endRe = langRe(mode.end);
        mode.terminator_end = reStr(mode.end) || '';
        if (mode.endsWithParent && parent.terminator_end)
          mode.terminator_end += (mode.end ? '|' : '') + parent.terminator_end;
      }
      if (mode.illegal)
        mode.illegalRe = langRe(mode.illegal);
      if (mode.relevance == null)
        mode.relevance = 1;
      if (!mode.contains) {
        mode.contains = [];
      }
      mode.contains = Array.prototype.concat.apply([], mode.contains.map(function(c) {
        return expand_mode(c === 'self' ? mode : c)
      }));
      mode.contains.forEach(function(c) {compileMode(c, mode);});

      if (mode.starts) {
        compileMode(mode.starts, parent);
      }

      var terminators =
        mode.contains.map(function(c) {
          return c.beginKeywords ? '\\.?(' + c.begin + ')\\.?' : c.begin;
        })
        .concat([mode.terminator_end, mode.illegal])
        .map(reStr)
        .filter(Boolean);
      mode.terminators = terminators.length ? langRe(terminators.join('|'), true) : {exec: function(/*s*/) {return null;}};
    }

    compileMode(language);
  }

  /*
  Core highlighting function. Accepts a language name, or an alias, and a
  string with the code to highlight. Returns an object with the following
  properties:

  - relevance (int)
  - value (an HTML string with highlighting markup)

  */
  function highlight(name, value, ignore_illegals, continuation) {

    function subMode(lexeme, mode) {
      var i, length;

      for (i = 0, length = mode.contains.length; i < length; i++) {
        if (testRe(mode.contains[i].beginRe, lexeme)) {
          return mode.contains[i];
        }
      }
    }

    function endOfMode(mode, lexeme) {
      if (testRe(mode.endRe, lexeme)) {
        while (mode.endsParent && mode.parent) {
          mode = mode.parent;
        }
        return mode;
      }
      if (mode.endsWithParent) {
        return endOfMode(mode.parent, lexeme);
      }
    }

    function isIllegal(lexeme, mode) {
      return !ignore_illegals && testRe(mode.illegalRe, lexeme);
    }

    function keywordMatch(mode, match) {
      var match_str = language.case_insensitive ? match[0].toLowerCase() : match[0];
      return mode.keywords.hasOwnProperty(match_str) && mode.keywords[match_str];
    }

    function buildSpan(classname, insideSpan, leaveOpen, noPrefix) {
      var classPrefix = noPrefix ? '' : options.classPrefix,
          openSpan    = '<span class="' + classPrefix,
          closeSpan   = leaveOpen ? '' : spanEndTag

      openSpan += classname + '">';

      return openSpan + insideSpan + closeSpan;
    }

    function processKeywords() {
      var keyword_match, last_index, match, result;

      if (!top.keywords)
        return escape(mode_buffer);

      result = '';
      last_index = 0;
      top.lexemesRe.lastIndex = 0;
      match = top.lexemesRe.exec(mode_buffer);

      while (match) {
        result += escape(mode_buffer.substring(last_index, match.index));
        keyword_match = keywordMatch(top, match);
        if (keyword_match) {
          relevance += keyword_match[1];
          result += buildSpan(keyword_match[0], escape(match[0]));
        } else {
          result += escape(match[0]);
        }
        last_index = top.lexemesRe.lastIndex;
        match = top.lexemesRe.exec(mode_buffer);
      }
      return result + escape(mode_buffer.substr(last_index));
    }

    function processSubLanguage() {
      var explicit = typeof top.subLanguage === 'string';
      if (explicit && !languages[top.subLanguage]) {
        return escape(mode_buffer);
      }

      var result = explicit ?
                   highlight(top.subLanguage, mode_buffer, true, continuations[top.subLanguage]) :
                   highlightAuto(mode_buffer, top.subLanguage.length ? top.subLanguage : undefined);

      // Counting embedded language score towards the host language may be disabled
      // with zeroing the containing mode relevance. Usecase in point is Markdown that
      // allows XML everywhere and makes every XML snippet to have a much larger Markdown
      // score.
      if (top.relevance > 0) {
        relevance += result.relevance;
      }
      if (explicit) {
        continuations[top.subLanguage] = result.top;
      }
      return buildSpan(result.language, result.value, false, true);
    }

    function processBuffer() {
      result += (top.subLanguage != null ? processSubLanguage() : processKeywords());
      mode_buffer = '';
    }

    function startNewMode(mode) {
      result += mode.className? buildSpan(mode.className, '', true): '';
      top = Object.create(mode, {parent: {value: top}});
    }

    function processLexeme(buffer, lexeme) {

      mode_buffer += buffer;

      if (lexeme == null) {
        processBuffer();
        return 0;
      }

      var new_mode = subMode(lexeme, top);
      if (new_mode) {
        if (new_mode.skip) {
          mode_buffer += lexeme;
        } else {
          if (new_mode.excludeBegin) {
            mode_buffer += lexeme;
          }
          processBuffer();
          if (!new_mode.returnBegin && !new_mode.excludeBegin) {
            mode_buffer = lexeme;
          }
        }
        startNewMode(new_mode, lexeme);
        return new_mode.returnBegin ? 0 : lexeme.length;
      }

      var end_mode = endOfMode(top, lexeme);
      if (end_mode) {
        var origin = top;
        if (origin.skip) {
          mode_buffer += lexeme;
        } else {
          if (!(origin.returnEnd || origin.excludeEnd)) {
            mode_buffer += lexeme;
          }
          processBuffer();
          if (origin.excludeEnd) {
            mode_buffer = lexeme;
          }
        }
        do {
          if (top.className) {
            result += spanEndTag;
          }
          if (!top.skip && !top.subLanguage) {
            relevance += top.relevance;
          }
          top = top.parent;
        } while (top !== end_mode.parent);
        if (end_mode.starts) {
          startNewMode(end_mode.starts, '');
        }
        return origin.returnEnd ? 0 : lexeme.length;
      }

      if (isIllegal(lexeme, top))
        throw new Error('Illegal lexeme "' + lexeme + '" for mode "' + (top.className || '<unnamed>') + '"');

      /*
      Parser should not reach this point as all types of lexemes should be caught
      earlier, but if it does due to some bug make sure it advances at least one
      character forward to prevent infinite looping.
      */
      mode_buffer += lexeme;
      return lexeme.length || 1;
    }

    var language = getLanguage(name);
    if (!language) {
      throw new Error('Unknown language: "' + name + '"');
    }

    compileLanguage(language);
    var top = continuation || language;
    var continuations = {}; // keep continuations for sub-languages
    var result = '', current;
    for(current = top; current !== language; current = current.parent) {
      if (current.className) {
        result = buildSpan(current.className, '', true) + result;
      }
    }
    var mode_buffer = '';
    var relevance = 0;
    try {
      var match, count, index = 0;
      while (true) {
        top.terminators.lastIndex = index;
        match = top.terminators.exec(value);
        if (!match)
          break;
        count = processLexeme(value.substring(index, match.index), match[0]);
        index = match.index + count;
      }
      processLexeme(value.substr(index));
      for(current = top; current.parent; current = current.parent) { // close dangling modes
        if (current.className) {
          result += spanEndTag;
        }
      }
      return {
        relevance: relevance,
        value: result,
        language: name,
        top: top
      };
    } catch (e) {
      if (e.message && e.message.indexOf('Illegal') !== -1) {
        return {
          relevance: 0,
          value: escape(value)
        };
      } else {
        throw e;
      }
    }
  }

  /*
  Highlighting with language detection. Accepts a string with the code to
  highlight. Returns an object with the following properties:

  - language (detected language)
  - relevance (int)
  - value (an HTML string with highlighting markup)
  - second_best (object with the same structure for second-best heuristically
    detected language, may be absent)

  */
  function highlightAuto(text, languageSubset) {
    languageSubset = languageSubset || options.languages || objectKeys(languages);
    var result = {
      relevance: 0,
      value: escape(text)
    };
    var second_best = result;
    languageSubset.filter(getLanguage).forEach(function(name) {
      var current = highlight(name, text, false);
      current.language = name;
      if (current.relevance > second_best.relevance) {
        second_best = current;
      }
      if (current.relevance > result.relevance) {
        second_best = result;
        result = current;
      }
    });
    if (second_best.language) {
      result.second_best = second_best;
    }
    return result;
  }

  /*
  Post-processing of the highlighted markup:

  - replace TABs with something more useful
  - replace real line-breaks with '<br>' for non-pre containers

  */
  function fixMarkup(value) {
    return !(options.tabReplace || options.useBR)
      ? value
      : value.replace(fixMarkupRe, function(match, p1) {
          if (options.useBR && match === '\n') {
            return '<br>';
          } else if (options.tabReplace) {
            return p1.replace(/\t/g, options.tabReplace);
          }
          return '';
      });
  }

  function buildClassName(prevClassName, currentLang, resultLang) {
    var language = currentLang ? aliases[currentLang] : resultLang,
        result   = [prevClassName.trim()];

    if (!prevClassName.match(/\bhljs\b/)) {
      result.push('hljs');
    }

    if (prevClassName.indexOf(language) === -1) {
      result.push(language);
    }

    return result.join(' ').trim();
  }

  /*
  Applies highlighting to a DOM node containing code. Accepts a DOM node and
  two optional parameters for fixMarkup.
  */
  function highlightBlock(block) {
    var node, originalStream, result, resultNode, text;
    var language = blockLanguage(block);

    if (isNotHighlighted(language))
        return;

    if (options.useBR) {
      node = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
      node.innerHTML = block.innerHTML.replace(/\n/g, '').replace(/<br[ \/]*>/g, '\n');
    } else {
      node = block;
    }
    text = node.textContent;
    result = language ? highlight(language, text, true) : highlightAuto(text);

    originalStream = nodeStream(node);
    if (originalStream.length) {
      resultNode = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
      resultNode.innerHTML = result.value;
      result.value = mergeStreams(originalStream, nodeStream(resultNode), text);
    }
    result.value = fixMarkup(result.value);

    block.innerHTML = result.value;
    block.className = buildClassName(block.className, language, result.language);
    block.result = {
      language: result.language,
      re: result.relevance
    };
    if (result.second_best) {
      block.second_best = {
        language: result.second_best.language,
        re: result.second_best.relevance
      };
    }
  }

  /*
  Updates highlight.js global options with values passed in the form of an object.
  */
  function configure(user_options) {
    options = inherit(options, user_options);
  }

  /*
  Applies highlighting to all <pre><code>..</code></pre> blocks on a page.
  */
  function initHighlighting() {
    if (initHighlighting.called)
      return;
    initHighlighting.called = true;

    var blocks = document.querySelectorAll('pre code');
    ArrayProto.forEach.call(blocks, highlightBlock);
  }

  /*
  Attaches highlighting to the page load event.
  */
  function initHighlightingOnLoad() {
    addEventListener('DOMContentLoaded', initHighlighting, false);
    addEventListener('load', initHighlighting, false);
  }

  function registerLanguage(name, language) {
    var lang = languages[name] = language(hljs);
    if (lang.aliases) {
      lang.aliases.forEach(function(alias) {aliases[alias] = name;});
    }
  }

  function listLanguages() {
    return objectKeys(languages);
  }

  function getLanguage(name) {
    name = (name || '').toLowerCase();
    return languages[name] || languages[aliases[name]];
  }

  /* Interface definition */

  hljs.highlight = highlight;
  hljs.highlightAuto = highlightAuto;
  hljs.fixMarkup = fixMarkup;
  hljs.highlightBlock = highlightBlock;
  hljs.configure = configure;
  hljs.initHighlighting = initHighlighting;
  hljs.initHighlightingOnLoad = initHighlightingOnLoad;
  hljs.registerLanguage = registerLanguage;
  hljs.listLanguages = listLanguages;
  hljs.getLanguage = getLanguage;
  hljs.inherit = inherit;

  // Common regexps
  hljs.IDENT_RE = '[a-zA-Z]\\w*';
  hljs.UNDERSCORE_IDENT_RE = '[a-zA-Z_]\\w*';
  hljs.NUMBER_RE = '\\b\\d+(\\.\\d+)?';
  hljs.C_NUMBER_RE = '(-?)(\\b0[xX][a-fA-F0-9]+|(\\b\\d+(\\.\\d*)?|\\.\\d+)([eE][-+]?\\d+)?)'; // 0x..., 0..., decimal, float
  hljs.BINARY_NUMBER_RE = '\\b(0b[01]+)'; // 0b...
  hljs.RE_STARTERS_RE = '!|!=|!==|%|%=|&|&&|&=|\\*|\\*=|\\+|\\+=|,|-|-=|/=|/|:|;|<<|<<=|<=|<|===|==|=|>>>=|>>=|>=|>>>|>>|>|\\?|\\[|\\{|\\(|\\^|\\^=|\\||\\|=|\\|\\||~';

  // Common modes
  hljs.BACKSLASH_ESCAPE = {
    begin: '\\\\[\\s\\S]', relevance: 0
  };
  hljs.APOS_STRING_MODE = {
    className: 'string',
    begin: '\'', end: '\'',
    illegal: '\\n',
    contains: [hljs.BACKSLASH_ESCAPE]
  };
  hljs.QUOTE_STRING_MODE = {
    className: 'string',
    begin: '"', end: '"',
    illegal: '\\n',
    contains: [hljs.BACKSLASH_ESCAPE]
  };
  hljs.PHRASAL_WORDS_MODE = {
    begin: /\b(a|an|the|are|I'm|isn't|don't|doesn't|won't|but|just|should|pretty|simply|enough|gonna|going|wtf|so|such|will|you|your|they|like|more)\b/
  };
  hljs.COMMENT = function (begin, end, inherits) {
    var mode = hljs.inherit(
      {
        className: 'comment',
        begin: begin, end: end,
        contains: []
      },
      inherits || {}
    );
    mode.contains.push(hljs.PHRASAL_WORDS_MODE);
    mode.contains.push({
      className: 'doctag',
      begin: '(?:TODO|FIXME|NOTE|BUG|XXX):',
      relevance: 0
    });
    return mode;
  };
  hljs.C_LINE_COMMENT_MODE = hljs.COMMENT('//', '$');
  hljs.C_BLOCK_COMMENT_MODE = hljs.COMMENT('/\\*', '\\*/');
  hljs.HASH_COMMENT_MODE = hljs.COMMENT('#', '$');
  hljs.NUMBER_MODE = {
    className: 'number',
    begin: hljs.NUMBER_RE,
    relevance: 0
  };
  hljs.C_NUMBER_MODE = {
    className: 'number',
    begin: hljs.C_NUMBER_RE,
    relevance: 0
  };
  hljs.BINARY_NUMBER_MODE = {
    className: 'number',
    begin: hljs.BINARY_NUMBER_RE,
    relevance: 0
  };
  hljs.CSS_NUMBER_MODE = {
    className: 'number',
    begin: hljs.NUMBER_RE + '(' +
      '%|em|ex|ch|rem'  +
      '|vw|vh|vmin|vmax' +
      '|cm|mm|in|pt|pc|px' +
      '|deg|grad|rad|turn' +
      '|s|ms' +
      '|Hz|kHz' +
      '|dpi|dpcm|dppx' +
      ')?',
    relevance: 0
  };
  hljs.REGEXP_MODE = {
    className: 'regexp',
    begin: /\//, end: /\/[gimuy]*/,
    illegal: /\n/,
    contains: [
      hljs.BACKSLASH_ESCAPE,
      {
        begin: /\[/, end: /\]/,
        relevance: 0,
        contains: [hljs.BACKSLASH_ESCAPE]
      }
    ]
  };
  hljs.TITLE_MODE = {
    className: 'title',
    begin: hljs.IDENT_RE,
    relevance: 0
  };
  hljs.UNDERSCORE_TITLE_MODE = {
    className: 'title',
    begin: hljs.UNDERSCORE_IDENT_RE,
    relevance: 0
  };
  hljs.METHOD_GUARD = {
    // excludes method names from keyword processing
    begin: '\\.\\s*' + hljs.UNDERSCORE_IDENT_RE,
    relevance: 0
  };

hljs.registerLanguage('cpp', function(hljs) {
  var CPP_PRIMITIVE_TYPES = {
    className: 'keyword',
    begin: '\\b[a-z\\d_]*_t\\b'
  };

  var STRINGS = {
    className: 'string',
    variants: [
      {
        begin: '(u8?|U)?L?"', end: '"',
        illegal: '\\n',
        contains: [hljs.BACKSLASH_ESCAPE]
      },
      {
        begin: '(u8?|U)?R"', end: '"',
        contains: [hljs.BACKSLASH_ESCAPE]
      },
      {
        begin: '\'\\\\?.', end: '\'',
        illegal: '.'
      }
    ]
  };

  var NUMBERS = {
    className: 'number',
    variants: [
      { begin: '\\b(0b[01\']+)' },
      { begin: '(-?)\\b([\\d\']+(\\.[\\d\']*)?|\\.[\\d\']+)(u|U|l|L|ul|UL|f|F|b|B)' },
      { begin: '(-?)(\\b0[xX][a-fA-F0-9\']+|(\\b[\\d\']+(\\.[\\d\']*)?|\\.[\\d\']+)([eE][-+]?[\\d\']+)?)' }
    ],
    relevance: 0
  };

  var PREPROCESSOR =       {
    className: 'meta',
    begin: /#\s*[a-z]+\b/, end: /$/,
    keywords: {
      'meta-keyword':
        'if else elif endif define undef warning error line ' +
        'pragma ifdef ifndef include'
    },
    contains: [
      {
        begin: /\\\n/, relevance: 0
      },
      hljs.inherit(STRINGS, {className: 'meta-string'}),
      {
        className: 'meta-string',
        begin: /<[^\n>]*>/, end: /$/,
        illegal: '\\n',
      },
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE
    ]
  };

  var FUNCTION_TITLE = hljs.IDENT_RE + '\\s*\\(';

  var CPP_KEYWORDS = {
    keyword: 'int float while private char catch import module export virtual operator sizeof ' +
      'dynamic_cast|10 typedef const_cast|10 const for static_cast|10 union namespace ' +
      'unsigned long volatile static protected bool template mutable if public friend ' +
      'do goto auto void enum else break extern using asm case typeid ' +
      'short reinterpret_cast|10 default double register explicit signed typename try this ' +
      'switch continue inline delete alignof constexpr decltype ' +
      'noexcept static_assert thread_local restrict _Bool complex _Complex _Imaginary ' +
      'atomic_bool atomic_char atomic_schar ' +
      'atomic_uchar atomic_short atomic_ushort atomic_int atomic_uint atomic_long atomic_ulong atomic_llong ' +
      'atomic_ullong new throw return ' +
      'and or not',
    built_in: 'std string cin cout cerr clog stdin stdout stderr stringstream istringstream ostringstream ' +
      'auto_ptr deque list queue stack vector map set bitset multiset multimap unordered_set ' +
      'unordered_map unordered_multiset unordered_multimap array shared_ptr abort abs acos ' +
      'asin atan2 atan calloc ceil cosh cos exit exp fabs floor fmod fprintf fputs free frexp ' +
      'fscanf isalnum isalpha iscntrl isdigit isgraph islower isprint ispunct isspace isupper ' +
      'isxdigit tolower toupper labs ldexp log10 log malloc realloc memchr memcmp memcpy memset modf pow ' +
      'printf putchar puts scanf sinh sin snprintf sprintf sqrt sscanf strcat strchr strcmp ' +
      'strcpy strcspn strlen strncat strncmp strncpy strpbrk strrchr strspn strstr tanh tan ' +
      'vfprintf vprintf vsprintf endl initializer_list unique_ptr',
    literal: 'true false nullptr NULL'
  };

  var EXPRESSION_CONTAINS = [
    CPP_PRIMITIVE_TYPES,
    hljs.C_LINE_COMMENT_MODE,
    hljs.C_BLOCK_COMMENT_MODE,
    NUMBERS,
    STRINGS
  ];

  return {
    aliases: ['c', 'cc', 'h', 'c++', 'h++', 'hpp'],
    keywords: CPP_KEYWORDS,
    illegal: '</',
    contains: EXPRESSION_CONTAINS.concat([
      PREPROCESSOR,
      {
        begin: '\\b(deque|list|queue|stack|vector|map|set|bitset|multiset|multimap|unordered_map|unordered_set|unordered_multiset|unordered_multimap|array)\\s*<', end: '>',
        keywords: CPP_KEYWORDS,
        contains: ['self', CPP_PRIMITIVE_TYPES]
      },
      {
        begin: hljs.IDENT_RE + '::',
        keywords: CPP_KEYWORDS
      },
      {
        // This mode covers expression context where we can't expect a function
        // definition and shouldn't highlight anything that looks like one:
        // `return some()`, `else if()`, `(x*sum(1, 2))`
        variants: [
          {begin: /=/, end: /;/},
          {begin: /\(/, end: /\)/},
          {beginKeywords: 'new throw return else', end: /;/}
        ],
        keywords: CPP_KEYWORDS,
        contains: EXPRESSION_CONTAINS.concat([
          {
            begin: /\(/, end: /\)/,
            keywords: CPP_KEYWORDS,
            contains: EXPRESSION_CONTAINS.concat(['self']),
            relevance: 0
          }
        ]),
        relevance: 0
      },
      {
        className: 'function',
        begin: '(' + hljs.IDENT_RE + '[\\*&\\s]+)+' + FUNCTION_TITLE,
        returnBegin: true, end: /[{;=]/,
        excludeEnd: true,
        keywords: CPP_KEYWORDS,
        illegal: /[^\w\s\*&]/,
        contains: [
          {
            begin: FUNCTION_TITLE, returnBegin: true,
            contains: [hljs.TITLE_MODE],
            relevance: 0
          },
          {
            className: 'params',
            begin: /\(/, end: /\)/,
            keywords: CPP_KEYWORDS,
            relevance: 0,
            contains: [
              hljs.C_LINE_COMMENT_MODE,
              hljs.C_BLOCK_COMMENT_MODE,
              STRINGS,
              NUMBERS,
              CPP_PRIMITIVE_TYPES
            ]
          },
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          PREPROCESSOR
        ]
      },
      {
        className: 'class',
        beginKeywords: 'class struct', end: /[{;:]/,
        contains: [
          {begin: /</, end: />/, contains: ['self']}, // skip generic stuff
          hljs.TITLE_MODE
        ]
      }
    ]),
    exports: {
      preprocessor: PREPROCESSOR,
      strings: STRINGS,
      keywords: CPP_KEYWORDS
    }
  };
});

hljs.registerLanguage('css', function(hljs) {
  var IDENT_RE = '[a-zA-Z-][a-zA-Z0-9_-]*';
  var RULE = {
    begin: /[A-Z\_\.\-]+\s*:/, returnBegin: true, end: ';', endsWithParent: true,
    contains: [
      {
        className: 'attribute',
        begin: /\S/, end: ':', excludeEnd: true,
        starts: {
          endsWithParent: true, excludeEnd: true,
          contains: [
            {
              begin: /[\w-]+\(/, returnBegin: true,
              contains: [
                {
                  className: 'built_in',
                  begin: /[\w-]+/
                },
                {
                  begin: /\(/, end: /\)/,
                  contains: [
                    hljs.APOS_STRING_MODE,
                    hljs.QUOTE_STRING_MODE
                  ]
                }
              ]
            },
            hljs.CSS_NUMBER_MODE,
            hljs.QUOTE_STRING_MODE,
            hljs.APOS_STRING_MODE,
            hljs.C_BLOCK_COMMENT_MODE,
            {
              className: 'number', begin: '#[0-9A-Fa-f]+'
            },
            {
              className: 'meta', begin: '!important'
            }
          ]
        }
      }
    ]
  };

  return {
    case_insensitive: true,
    illegal: /[=\/|'\$]/,
    contains: [
      hljs.C_BLOCK_COMMENT_MODE,
      {
        className: 'selector-id', begin: /#[A-Za-z0-9_-]+/
      },
      {
        className: 'selector-class', begin: /\.[A-Za-z0-9_-]+/
      },
      {
        className: 'selector-attr',
        begin: /\[/, end: /\]/,
        illegal: '$'
      },
      {
        className: 'selector-pseudo',
        begin: /:(:)?[a-zA-Z0-9\_\-\+\(\)"'.]+/
      },
      {
        begin: '@(font-face|page)',
        lexemes: '[a-z-]+',
        keywords: 'font-face page'
      },
      {
        begin: '@', end: '[{;]', // at_rule eating first "{" is a good thing
                                 // because it doesn’t let it to be parsed as
                                 // a rule set but instead drops parser into
                                 // the default mode which is how it should be.
        illegal: /:/, // break on Less variables @var: ...
        contains: [
          {
            className: 'keyword',
            begin: /\w+/
          },
          {
            begin: /\s/, endsWithParent: true, excludeEnd: true,
            relevance: 0,
            contains: [
              hljs.APOS_STRING_MODE, hljs.QUOTE_STRING_MODE,
              hljs.CSS_NUMBER_MODE
            ]
          }
        ]
      },
      {
        className: 'selector-tag', begin: IDENT_RE,
        relevance: 0
      },
      {
        begin: '{', end: '}',
        illegal: /\S/,
        contains: [
          hljs.C_BLOCK_COMMENT_MODE,
          RULE,
        ]
      }
    ]
  };
});

hljs.registerLanguage('glsl', function(hljs) {
  return {
    keywords: {
      keyword:
        // Statements
        'break continue discard do else for if return while switch case default ' +
        // Qualifiers
        'attribute binding buffer ccw centroid centroid varying coherent column_major const cw ' +
        'depth_any depth_greater depth_less depth_unchanged early_fragment_tests equal_spacing ' +
        'flat fractional_even_spacing fractional_odd_spacing highp in index inout invariant ' +
        'invocations isolines layout line_strip lines lines_adjacency local_size_x local_size_y ' +
        'local_size_z location lowp max_vertices mediump noperspective offset origin_upper_left ' +
        'out packed patch pixel_center_integer point_mode points precise precision quads r11f_g11f_b10f '+
        'r16 r16_snorm r16f r16i r16ui r32f r32i r32ui r8 r8_snorm r8i r8ui readonly restrict ' +
        'rg16 rg16_snorm rg16f rg16i rg16ui rg32f rg32i rg32ui rg8 rg8_snorm rg8i rg8ui rgb10_a2 ' +
        'rgb10_a2ui rgba16 rgba16_snorm rgba16f rgba16i rgba16ui rgba32f rgba32i rgba32ui rgba8 ' +
        'rgba8_snorm rgba8i rgba8ui row_major sample shared smooth std140 std430 stream triangle_strip ' +
        'triangles triangles_adjacency uniform varying vertices volatile writeonly',
      type:
        'atomic_uint bool bvec2 bvec3 bvec4 dmat2 dmat2x2 dmat2x3 dmat2x4 dmat3 dmat3x2 dmat3x3 ' +
        'dmat3x4 dmat4 dmat4x2 dmat4x3 dmat4x4 double dvec2 dvec3 dvec4 float iimage1D iimage1DArray ' +
        'iimage2D iimage2DArray iimage2DMS iimage2DMSArray iimage2DRect iimage3D iimageBuffer' +
        'iimageCube iimageCubeArray image1D image1DArray image2D image2DArray image2DMS image2DMSArray ' +
        'image2DRect image3D imageBuffer imageCube imageCubeArray int isampler1D isampler1DArray ' +
        'isampler2D isampler2DArray isampler2DMS isampler2DMSArray isampler2DRect isampler3D ' +
        'isamplerBuffer isamplerCube isamplerCubeArray ivec2 ivec3 ivec4 mat2 mat2x2 mat2x3 ' +
        'mat2x4 mat3 mat3x2 mat3x3 mat3x4 mat4 mat4x2 mat4x3 mat4x4 sampler1D sampler1DArray ' +
        'sampler1DArrayShadow sampler1DShadow sampler2D sampler2DArray sampler2DArrayShadow ' +
        'sampler2DMS sampler2DMSArray sampler2DRect sampler2DRectShadow sampler2DShadow sampler3D ' +
        'samplerBuffer samplerCube samplerCubeArray samplerCubeArrayShadow samplerCubeShadow ' +
        'image1D uimage1DArray uimage2D uimage2DArray uimage2DMS uimage2DMSArray uimage2DRect ' +
        'uimage3D uimageBuffer uimageCube uimageCubeArray uint usampler1D usampler1DArray ' +
        'usampler2D usampler2DArray usampler2DMS usampler2DMSArray usampler2DRect usampler3D ' +
        'samplerBuffer usamplerCube usamplerCubeArray uvec2 uvec3 uvec4 vec2 vec3 vec4 void',
      built_in:
        // Constants
        'gl_MaxAtomicCounterBindings gl_MaxAtomicCounterBufferSize gl_MaxClipDistances gl_MaxClipPlanes ' +
        'gl_MaxCombinedAtomicCounterBuffers gl_MaxCombinedAtomicCounters gl_MaxCombinedImageUniforms ' +
        'gl_MaxCombinedImageUnitsAndFragmentOutputs gl_MaxCombinedTextureImageUnits gl_MaxComputeAtomicCounterBuffers ' +
        'gl_MaxComputeAtomicCounters gl_MaxComputeImageUniforms gl_MaxComputeTextureImageUnits ' +
        'gl_MaxComputeUniformComponents gl_MaxComputeWorkGroupCount gl_MaxComputeWorkGroupSize ' +
        'gl_MaxDrawBuffers gl_MaxFragmentAtomicCounterBuffers gl_MaxFragmentAtomicCounters ' +
        'gl_MaxFragmentImageUniforms gl_MaxFragmentInputComponents gl_MaxFragmentInputVectors ' +
        'gl_MaxFragmentUniformComponents gl_MaxFragmentUniformVectors gl_MaxGeometryAtomicCounterBuffers ' +
        'gl_MaxGeometryAtomicCounters gl_MaxGeometryImageUniforms gl_MaxGeometryInputComponents ' +
        'gl_MaxGeometryOutputComponents gl_MaxGeometryOutputVertices gl_MaxGeometryTextureImageUnits ' +
        'gl_MaxGeometryTotalOutputComponents gl_MaxGeometryUniformComponents gl_MaxGeometryVaryingComponents ' +
        'gl_MaxImageSamples gl_MaxImageUnits gl_MaxLights gl_MaxPatchVertices gl_MaxProgramTexelOffset ' +
        'gl_MaxTessControlAtomicCounterBuffers gl_MaxTessControlAtomicCounters gl_MaxTessControlImageUniforms ' +
        'gl_MaxTessControlInputComponents gl_MaxTessControlOutputComponents gl_MaxTessControlTextureImageUnits ' +
        'gl_MaxTessControlTotalOutputComponents gl_MaxTessControlUniformComponents ' +
        'gl_MaxTessEvaluationAtomicCounterBuffers gl_MaxTessEvaluationAtomicCounters ' +
        'gl_MaxTessEvaluationImageUniforms gl_MaxTessEvaluationInputComponents gl_MaxTessEvaluationOutputComponents ' +
        'gl_MaxTessEvaluationTextureImageUnits gl_MaxTessEvaluationUniformComponents ' +
        'gl_MaxTessGenLevel gl_MaxTessPatchComponents gl_MaxTextureCoords gl_MaxTextureImageUnits ' +
        'gl_MaxTextureUnits gl_MaxVaryingComponents gl_MaxVaryingFloats gl_MaxVaryingVectors ' +
        'gl_MaxVertexAtomicCounterBuffers gl_MaxVertexAtomicCounters gl_MaxVertexAttribs gl_MaxVertexImageUniforms ' +
        'gl_MaxVertexOutputComponents gl_MaxVertexOutputVectors gl_MaxVertexTextureImageUnits ' +
        'gl_MaxVertexUniformComponents gl_MaxVertexUniformVectors gl_MaxViewports gl_MinProgramTexelOffset ' +
        // Variables
        'gl_BackColor gl_BackLightModelProduct gl_BackLightProduct gl_BackMaterial ' +
        'gl_BackSecondaryColor gl_ClipDistance gl_ClipPlane gl_ClipVertex gl_Color ' +
        'gl_DepthRange gl_EyePlaneQ gl_EyePlaneR gl_EyePlaneS gl_EyePlaneT gl_Fog gl_FogCoord ' +
        'gl_FogFragCoord gl_FragColor gl_FragCoord gl_FragData gl_FragDepth gl_FrontColor ' +
        'gl_FrontFacing gl_FrontLightModelProduct gl_FrontLightProduct gl_FrontMaterial ' +
        'gl_FrontSecondaryColor gl_GlobalInvocationID gl_InstanceID gl_InvocationID gl_Layer gl_LightModel ' +
        'gl_LightSource gl_LocalInvocationID gl_LocalInvocationIndex gl_ModelViewMatrix ' +
        'gl_ModelViewMatrixInverse gl_ModelViewMatrixInverseTranspose gl_ModelViewMatrixTranspose ' +
        'gl_ModelViewProjectionMatrix gl_ModelViewProjectionMatrixInverse gl_ModelViewProjectionMatrixInverseTranspose ' +
        'gl_ModelViewProjectionMatrixTranspose gl_MultiTexCoord0 gl_MultiTexCoord1 gl_MultiTexCoord2 ' +
        'gl_MultiTexCoord3 gl_MultiTexCoord4 gl_MultiTexCoord5 gl_MultiTexCoord6 gl_MultiTexCoord7 ' +
        'gl_Normal gl_NormalMatrix gl_NormalScale gl_NumSamples gl_NumWorkGroups gl_ObjectPlaneQ ' +
        'gl_ObjectPlaneR gl_ObjectPlaneS gl_ObjectPlaneT gl_PatchVerticesIn gl_Point gl_PointCoord ' +
        'gl_PointSize gl_Position gl_PrimitiveID gl_PrimitiveIDIn gl_ProjectionMatrix gl_ProjectionMatrixInverse ' +
        'gl_ProjectionMatrixInverseTranspose gl_ProjectionMatrixTranspose gl_SampleID gl_SampleMask ' +
        'gl_SampleMaskIn gl_SamplePosition gl_SecondaryColor gl_TessCoord gl_TessLevelInner gl_TessLevelOuter ' +
        'gl_TexCoord gl_TextureEnvColor gl_TextureMatrix gl_TextureMatrixInverse gl_TextureMatrixInverseTranspose ' +
        'gl_TextureMatrixTranspose gl_Vertex gl_VertexID gl_ViewportIndex gl_WorkGroupID gl_WorkGroupSize gl_in gl_out ' +
        // Functions
        'EmitStreamVertex EmitVertex EndPrimitive EndStreamPrimitive abs acos acosh all any asin ' +
        'asinh atan atanh atomicAdd atomicAnd atomicCompSwap atomicCounter atomicCounterDecrement ' +
        'atomicCounterIncrement atomicExchange atomicMax atomicMin atomicOr atomicXor barrier ' +
        'bitCount bitfieldExtract bitfieldInsert bitfieldReverse ceil clamp cos cosh cross ' +
        'dFdx dFdy degrees determinant distance dot equal exp exp2 faceforward findLSB findMSB ' +
        'floatBitsToInt floatBitsToUint floor fma fract frexp ftransform fwidth greaterThan ' +
        'greaterThanEqual groupMemoryBarrier imageAtomicAdd imageAtomicAnd imageAtomicCompSwap ' +
        'imageAtomicExchange imageAtomicMax imageAtomicMin imageAtomicOr imageAtomicXor imageLoad ' +
        'imageSize imageStore imulExtended intBitsToFloat interpolateAtCentroid interpolateAtOffset ' +
        'interpolateAtSample inverse inversesqrt isinf isnan ldexp length lessThan lessThanEqual log ' +
        'log2 matrixCompMult max memoryBarrier memoryBarrierAtomicCounter memoryBarrierBuffer ' +
        'memoryBarrierImage memoryBarrierShared min mix mod modf noise1 noise2 noise3 noise4 ' +
        'normalize not notEqual outerProduct packDouble2x32 packHalf2x16 packSnorm2x16 packSnorm4x8 ' +
        'packUnorm2x16 packUnorm4x8 pow radians reflect refract round roundEven shadow1D shadow1DLod ' +
        'shadow1DProj shadow1DProjLod shadow2D shadow2DLod shadow2DProj shadow2DProjLod sign sin sinh ' +
        'smoothstep sqrt step tan tanh texelFetch texelFetchOffset texture texture1D texture1DLod ' +
        'texture1DProj texture1DProjLod texture2D texture2DLod texture2DProj texture2DProjLod ' +
        'texture3D texture3DLod texture3DProj texture3DProjLod textureCube textureCubeLod ' +
        'textureGather textureGatherOffset textureGatherOffsets textureGrad textureGradOffset ' +
        'textureLod textureLodOffset textureOffset textureProj textureProjGrad textureProjGradOffset ' +
        'textureProjLod textureProjLodOffset textureProjOffset textureQueryLevels textureQueryLod ' +
        'textureSize transpose trunc uaddCarry uintBitsToFloat umulExtended unpackDouble2x32 ' +
        'unpackHalf2x16 unpackSnorm2x16 unpackSnorm4x8 unpackUnorm2x16 unpackUnorm4x8 usubBorrow',
      literal: 'true false'
    },
    illegal: '"',
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.C_NUMBER_MODE,
      {
        className: 'meta',
        begin: '#', end: '$'
      }
    ]
  };
});

hljs.registerLanguage('gml', function(hljs) {
  var GML_KEYWORDS = {
    keywords: 'begin end if then else while do for break continue with until ' +
      'repeat exit and or xor not return mod div switch case default var ' +
      'globalvar enum #macro #region #endregion',
    built_in: 'is_real is_string is_array is_undefined is_int32 is_int64 ' +
      'is_ptr is_vec3 is_vec4 is_matrix is_bool typeof ' +
      'variable_global_exists variable_global_get variable_global_set ' +
      'variable_instance_exists variable_instance_get variable_instance_set ' +
      'variable_instance_get_names array_length_1d array_length_2d ' +
      'array_height_2d array_equals array_create array_copy random ' +
      'random_range irandom irandom_range random_set_seed random_get_seed ' +
      'randomize randomise choose abs round floor ceil sign frac sqrt sqr ' +
      'exp ln log2 log10 sin cos tan arcsin arccos arctan arctan2 dsin dcos ' +
      'dtan darcsin darccos darctan darctan2 degtorad radtodeg power logn ' +
      'min max mean median clamp lerp dot_product dot_product_3d ' +
      'dot_product_normalised dot_product_3d_normalised ' +
      'dot_product_normalized dot_product_3d_normalized math_set_epsilon ' +
      'math_get_epsilon angle_difference point_distance_3d point_distance ' +
      'point_direction lengthdir_x lengthdir_y real string int64 ptr ' +
      'string_format chr ansi_char ord string_length string_byte_length ' +
      'string_pos string_copy string_char_at string_ord_at string_byte_at ' +
      'string_set_byte_at string_delete string_insert string_lower ' +
      'string_upper string_repeat string_letters string_digits ' +
      'string_lettersdigits string_replace string_replace_all string_count ' +
      'string_hash_to_newline clipboard_has_text clipboard_set_text ' +
      'clipboard_get_text date_current_datetime date_create_datetime ' +
      'date_valid_datetime date_inc_year date_inc_month date_inc_week ' +
      'date_inc_day date_inc_hour date_inc_minute date_inc_second ' +
      'date_get_year date_get_month date_get_week date_get_day ' +
      'date_get_hour date_get_minute date_get_second date_get_weekday ' +
      'date_get_day_of_year date_get_hour_of_year date_get_minute_of_year ' +
      'date_get_second_of_year date_year_span date_month_span ' +
      'date_week_span date_day_span date_hour_span date_minute_span ' +
      'date_second_span date_compare_datetime date_compare_date ' +
      'date_compare_time date_date_of date_time_of date_datetime_string ' +
      'date_date_string date_time_string date_days_in_month ' +
      'date_days_in_year date_leap_year date_is_today date_set_timezone ' +
      'date_get_timezone game_set_speed game_get_speed motion_set ' +
      'motion_add place_free place_empty place_meeting place_snapped ' +
      'move_random move_snap move_towards_point move_contact_solid ' +
      'move_contact_all move_outside_solid move_outside_all ' +
      'move_bounce_solid move_bounce_all move_wrap distance_to_point ' +
      'distance_to_object position_empty position_meeting path_start ' +
      'path_end mp_linear_step mp_potential_step mp_linear_step_object ' +
      'mp_potential_step_object mp_potential_settings mp_linear_path ' +
      'mp_potential_path mp_linear_path_object mp_potential_path_object ' +
      'mp_grid_create mp_grid_destroy mp_grid_clear_all mp_grid_clear_cell ' +
      'mp_grid_clear_rectangle mp_grid_add_cell mp_grid_get_cell ' +
      'mp_grid_add_rectangle mp_grid_add_instances mp_grid_path ' +
      'mp_grid_draw mp_grid_to_ds_grid collision_point collision_rectangle ' +
      'collision_circle collision_ellipse collision_line point_in_rectangle ' +
      'point_in_triangle point_in_circle rectangle_in_rectangle ' +
      'rectangle_in_triangle rectangle_in_circle instance_find ' +
      'instance_exists instance_number instance_position instance_nearest ' +
      'instance_furthest instance_place instance_create_depth ' +
      'instance_create_layer instance_copy instance_change instance_destroy ' +
      'position_destroy position_change instance_id_get ' +
      'instance_deactivate_all instance_deactivate_object ' +
      'instance_deactivate_region instance_activate_all ' +
      'instance_activate_object instance_activate_region room_goto ' +
      'room_goto_previous room_goto_next room_previous room_next ' +
      'room_restart game_end game_restart game_load game_save ' +
      'game_save_buffer game_load_buffer event_perform event_user ' +
      'event_perform_object event_inherited show_debug_message ' +
      'show_debug_overlay debug_event debug_get_callstack alarm_get ' +
      'alarm_set font_texture_page_size keyboard_set_map keyboard_get_map ' +
      'keyboard_unset_map keyboard_check keyboard_check_pressed ' +
      'keyboard_check_released keyboard_check_direct keyboard_get_numlock ' +
      'keyboard_set_numlock keyboard_key_press keyboard_key_release ' +
      'keyboard_clear io_clear mouse_check_button ' +
      'mouse_check_button_pressed mouse_check_button_released ' +
      'mouse_wheel_up mouse_wheel_down mouse_clear draw_self draw_sprite ' +
      'draw_sprite_pos draw_sprite_ext draw_sprite_stretched ' +
      'draw_sprite_stretched_ext draw_sprite_tiled draw_sprite_tiled_ext ' +
      'draw_sprite_part draw_sprite_part_ext draw_sprite_general draw_clear ' +
      'draw_clear_alpha draw_point draw_line draw_line_width draw_rectangle ' +
      'draw_roundrect draw_roundrect_ext draw_triangle draw_circle ' +
      'draw_ellipse draw_set_circle_precision draw_arrow draw_button ' +
      'draw_path draw_healthbar draw_getpixel draw_getpixel_ext ' +
      'draw_set_colour draw_set_color draw_set_alpha draw_get_colour ' +
      'draw_get_color draw_get_alpha merge_colour make_colour_rgb ' +
      'make_colour_hsv colour_get_red colour_get_green colour_get_blue ' +
      'colour_get_hue colour_get_saturation colour_get_value merge_color ' +
      'make_color_rgb make_color_hsv color_get_red color_get_green ' +
      'color_get_blue color_get_hue color_get_saturation color_get_value ' +
      'merge_color screen_save screen_save_part draw_set_font ' +
      'draw_set_halign draw_set_valign draw_text draw_text_ext string_width ' +
      'string_height string_width_ext string_height_ext ' +
      'draw_text_transformed draw_text_ext_transformed draw_text_colour ' +
      'draw_text_ext_colour draw_text_transformed_colour ' +
      'draw_text_ext_transformed_colour draw_text_color draw_text_ext_color ' +
      'draw_text_transformed_color draw_text_ext_transformed_color ' +
      'draw_point_colour draw_line_colour draw_line_width_colour ' +
      'draw_rectangle_colour draw_roundrect_colour ' +
      'draw_roundrect_colour_ext draw_triangle_colour draw_circle_colour ' +
      'draw_ellipse_colour draw_point_color draw_line_color ' +
      'draw_line_width_color draw_rectangle_color draw_roundrect_color ' +
      'draw_roundrect_color_ext draw_triangle_color draw_circle_color ' +
      'draw_ellipse_color draw_primitive_begin draw_vertex ' +
      'draw_vertex_colour draw_vertex_color draw_primitive_end ' +
      'sprite_get_uvs font_get_uvs sprite_get_texture font_get_texture ' +
      'texture_get_width texture_get_height texture_get_uvs ' +
      'draw_primitive_begin_texture draw_vertex_texture ' +
      'draw_vertex_texture_colour draw_vertex_texture_color ' +
      'texture_global_scale surface_create surface_create_ext ' +
      'surface_resize surface_free surface_exists surface_get_width ' +
      'surface_get_height surface_get_texture surface_set_target ' +
      'surface_set_target_ext surface_reset_target surface_depth_disable ' +
      'surface_get_depth_disable draw_surface draw_surface_stretched ' +
      'draw_surface_tiled draw_surface_part draw_surface_ext ' +
      'draw_surface_stretched_ext draw_surface_tiled_ext ' +
      'draw_surface_part_ext draw_surface_general surface_getpixel ' +
      'surface_getpixel_ext surface_save surface_save_part surface_copy ' +
      'surface_copy_part application_surface_draw_enable ' +
      'application_get_position application_surface_enable ' +
      'application_surface_is_enabled display_get_width display_get_height ' +
      'display_get_orientation display_get_gui_width display_get_gui_height ' +
      'display_reset display_mouse_get_x display_mouse_get_y ' +
      'display_mouse_set window_set_fullscreen window_get_fullscreen ' +
      'window_set_caption window_set_min_width window_set_max_width ' +
      'window_set_min_height window_set_max_height window_get_visible_rects ' +
      'window_get_caption window_set_cursor window_get_cursor ' +
      'window_set_colour window_get_colour window_set_color ' +
      'window_get_color window_set_position window_set_size ' +
      'window_set_rectangle window_center window_get_x window_get_y ' +
      'window_get_width window_get_height window_mouse_get_x ' +
      'window_mouse_get_y window_mouse_set window_view_mouse_get_x ' +
      'window_view_mouse_get_y window_views_mouse_get_x ' +
      'window_views_mouse_get_y audio_listener_position ' +
      'audio_listener_velocity audio_listener_orientation ' +
      'audio_emitter_position audio_emitter_create audio_emitter_free ' +
      'audio_emitter_exists audio_emitter_pitch audio_emitter_velocity ' +
      'audio_emitter_falloff audio_emitter_gain audio_play_sound ' +
      'audio_play_sound_on audio_play_sound_at audio_stop_sound ' +
      'audio_resume_music audio_music_is_playing audio_resume_sound ' +
      'audio_pause_sound audio_pause_music audio_channel_num ' +
      'audio_sound_length audio_get_type audio_falloff_set_model ' +
      'audio_play_music audio_stop_music audio_master_gain audio_music_gain ' +
      'audio_sound_gain audio_sound_pitch audio_stop_all audio_resume_all ' +
      'audio_pause_all audio_is_playing audio_is_paused audio_exists ' +
      'audio_sound_set_track_position audio_sound_get_track_position ' +
      'audio_emitter_get_gain audio_emitter_get_pitch audio_emitter_get_x ' +
      'audio_emitter_get_y audio_emitter_get_z audio_emitter_get_vx ' +
      'audio_emitter_get_vy audio_emitter_get_vz ' +
      'audio_listener_set_position audio_listener_set_velocity ' +
      'audio_listener_set_orientation audio_listener_get_data ' +
      'audio_set_master_gain audio_get_master_gain audio_sound_get_gain ' +
      'audio_sound_get_pitch audio_get_name audio_sound_set_track_position ' +
      'audio_sound_get_track_position audio_create_stream ' +
      'audio_destroy_stream audio_create_sync_group ' +
      'audio_destroy_sync_group audio_play_in_sync_group ' +
      'audio_start_sync_group audio_stop_sync_group audio_pause_sync_group ' +
      'audio_resume_sync_group audio_sync_group_get_track_pos ' +
      'audio_sync_group_debug audio_sync_group_is_playing audio_debug ' +
      'audio_group_load audio_group_unload audio_group_is_loaded ' +
      'audio_group_load_progress audio_group_name audio_group_stop_all ' +
      'audio_group_set_gain audio_create_buffer_sound ' +
      'audio_free_buffer_sound audio_create_play_queue ' +
      'audio_free_play_queue audio_queue_sound audio_get_recorder_count ' +
      'audio_get_recorder_info audio_start_recording audio_stop_recording ' +
      'audio_sound_get_listener_mask audio_emitter_get_listener_mask ' +
      'audio_get_listener_mask audio_sound_set_listener_mask ' +
      'audio_emitter_set_listener_mask audio_set_listener_mask ' +
      'audio_get_listener_count audio_get_listener_info audio_system ' +
      'show_message show_message_async clickable_add clickable_add_ext ' +
      'clickable_change clickable_change_ext clickable_delete ' +
      'clickable_exists clickable_set_style show_question ' +
      'show_question_async get_integer get_string get_integer_async ' +
      'get_string_async get_login_async get_open_filename get_save_filename ' +
      'get_open_filename_ext get_save_filename_ext show_error ' +
      'highscore_clear highscore_add highscore_value highscore_name ' +
      'draw_highscore sprite_exists sprite_get_name sprite_get_number ' +
      'sprite_get_width sprite_get_height sprite_get_xoffset ' +
      'sprite_get_yoffset sprite_get_bbox_left sprite_get_bbox_right ' +
      'sprite_get_bbox_top sprite_get_bbox_bottom sprite_save ' +
      'sprite_save_strip sprite_set_cache_size sprite_set_cache_size_ext ' +
      'sprite_get_tpe sprite_prefetch sprite_prefetch_multi sprite_flush ' +
      'sprite_flush_multi sprite_set_speed sprite_get_speed_type ' +
      'sprite_get_speed font_exists font_get_name font_get_fontname ' +
      'font_get_bold font_get_italic font_get_first font_get_last ' +
      'font_get_size font_set_cache_size path_exists path_get_name ' +
      'path_get_length path_get_time path_get_kind path_get_closed ' +
      'path_get_precision path_get_number path_get_point_x path_get_point_y ' +
      'path_get_point_speed path_get_x path_get_y path_get_speed ' +
      'script_exists script_get_name timeline_add timeline_delete ' +
      'timeline_clear timeline_exists timeline_get_name ' +
      'timeline_moment_clear timeline_moment_add_script timeline_size ' +
      'timeline_max_moment object_exists object_get_name object_get_sprite ' +
      'object_get_solid object_get_visible object_get_persistent ' +
      'object_get_mask object_get_parent object_get_physics ' +
      'object_is_ancestor room_exists room_get_name sprite_set_offset ' +
      'sprite_duplicate sprite_assign sprite_merge sprite_add ' +
      'sprite_replace sprite_create_from_surface sprite_add_from_surface ' +
      'sprite_delete sprite_set_alpha_from_sprite sprite_collision_mask ' +
      'font_add_enable_aa font_add_get_enable_aa font_add font_add_sprite ' +
      'font_add_sprite_ext font_replace font_replace_sprite ' +
      'font_replace_sprite_ext font_delete path_set_kind path_set_closed ' +
      'path_set_precision path_add path_assign path_duplicate path_append ' +
      'path_delete path_add_point path_insert_point path_change_point ' +
      'path_delete_point path_clear_points path_reverse path_mirror ' +
      'path_flip path_rotate path_rescale path_shift script_execute ' +
      'object_set_sprite object_set_solid object_set_visible ' +
      'object_set_persistent object_set_mask room_set_width room_set_height ' +
      'room_set_persistent room_set_background_colour ' +
      'room_set_background_color room_set_view room_set_viewport ' +
      'room_get_viewport room_set_view_enabled room_add room_duplicate ' +
      'room_assign room_instance_add room_instance_clear room_get_camera ' +
      'room_set_camera asset_get_index asset_get_type ' +
      'file_text_open_from_string file_text_open_read file_text_open_write ' +
      'file_text_open_append file_text_close file_text_write_string ' +
      'file_text_write_real file_text_writeln file_text_read_string ' +
      'file_text_read_real file_text_readln file_text_eof file_text_eoln ' +
      'file_exists file_delete file_rename file_copy directory_exists ' +
      'directory_create directory_destroy file_find_first file_find_next ' +
      'file_find_close file_attributes filename_name filename_path ' +
      'filename_dir filename_drive filename_ext filename_change_ext ' +
      'file_bin_open file_bin_rewrite file_bin_close file_bin_position ' +
      'file_bin_size file_bin_seek file_bin_write_byte file_bin_read_byte ' +
      'parameter_count parameter_string environment_get_variable ' +
      'ini_open_from_string ini_open ini_close ini_read_string ' +
      'ini_read_real ini_write_string ini_write_real ini_key_exists ' +
      'ini_section_exists ini_key_delete ini_section_delete ' +
      'ds_set_precision ds_exists ds_stack_create ds_stack_destroy ' +
      'ds_stack_clear ds_stack_copy ds_stack_size ds_stack_empty ' +
      'ds_stack_push ds_stack_pop ds_stack_top ds_stack_write ds_stack_read ' +
      'ds_queue_create ds_queue_destroy ds_queue_clear ds_queue_copy ' +
      'ds_queue_size ds_queue_empty ds_queue_enqueue ds_queue_dequeue ' +
      'ds_queue_head ds_queue_tail ds_queue_write ds_queue_read ' +
      'ds_list_create ds_list_destroy ds_list_clear ds_list_copy ' +
      'ds_list_size ds_list_empty ds_list_add ds_list_insert ' +
      'ds_list_replace ds_list_delete ds_list_find_index ds_list_find_value ' +
      'ds_list_mark_as_list ds_list_mark_as_map ds_list_sort ' +
      'ds_list_shuffle ds_list_write ds_list_read ds_list_set ds_map_create ' +
      'ds_map_destroy ds_map_clear ds_map_copy ds_map_size ds_map_empty ' +
      'ds_map_add ds_map_add_list ds_map_add_map ds_map_replace ' +
      'ds_map_replace_map ds_map_replace_list ds_map_delete ds_map_exists ' +
      'ds_map_find_value ds_map_find_previous ds_map_find_next ' +
      'ds_map_find_first ds_map_find_last ds_map_write ds_map_read ' +
      'ds_map_secure_save ds_map_secure_load ds_map_secure_load_buffer ' +
      'ds_map_secure_save_buffer ds_map_set ds_priority_create ' +
      'ds_priority_destroy ds_priority_clear ds_priority_copy ' +
      'ds_priority_size ds_priority_empty ds_priority_add ' +
      'ds_priority_change_priority ds_priority_find_priority ' +
      'ds_priority_delete_value ds_priority_delete_min ds_priority_find_min ' +
      'ds_priority_delete_max ds_priority_find_max ds_priority_write ' +
      'ds_priority_read ds_grid_create ds_grid_destroy ds_grid_copy ' +
      'ds_grid_resize ds_grid_width ds_grid_height ds_grid_clear ' +
      'ds_grid_set ds_grid_add ds_grid_multiply ds_grid_set_region ' +
      'ds_grid_add_region ds_grid_multiply_region ds_grid_set_disk ' +
      'ds_grid_add_disk ds_grid_multiply_disk ds_grid_set_grid_region ' +
      'ds_grid_add_grid_region ds_grid_multiply_grid_region ds_grid_get ' +
      'ds_grid_get_sum ds_grid_get_max ds_grid_get_min ds_grid_get_mean ' +
      'ds_grid_get_disk_sum ds_grid_get_disk_min ds_grid_get_disk_max ' +
      'ds_grid_get_disk_mean ds_grid_value_exists ds_grid_value_x ' +
      'ds_grid_value_y ds_grid_value_disk_exists ds_grid_value_disk_x ' +
      'ds_grid_value_disk_y ds_grid_shuffle ds_grid_write ds_grid_read ' +
      'ds_grid_sort ds_grid_set ds_grid_get effect_create_below ' +
      'effect_create_above effect_clear part_type_create part_type_destroy ' +
      'part_type_exists part_type_clear part_type_shape part_type_sprite ' +
      'part_type_size part_type_scale part_type_orientation part_type_life ' +
      'part_type_step part_type_death part_type_speed part_type_direction ' +
      'part_type_gravity part_type_colour1 part_type_colour2 ' +
      'part_type_colour3 part_type_colour_mix part_type_colour_rgb ' +
      'part_type_colour_hsv part_type_color1 part_type_color2 ' +
      'part_type_color3 part_type_color_mix part_type_color_rgb ' +
      'part_type_color_hsv part_type_alpha1 part_type_alpha2 ' +
      'part_type_alpha3 part_type_blend part_system_create ' +
      'part_system_create_layer part_system_destroy part_system_exists ' +
      'part_system_clear part_system_draw_order part_system_depth ' +
      'part_system_position part_system_automatic_update ' +
      'part_system_automatic_draw part_system_update part_system_drawit ' +
      'part_system_get_layer part_system_layer part_particles_create ' +
      'part_particles_create_colour part_particles_create_color ' +
      'part_particles_clear part_particles_count part_emitter_create ' +
      'part_emitter_destroy part_emitter_destroy_all part_emitter_exists ' +
      'part_emitter_clear part_emitter_region part_emitter_burst ' +
      'part_emitter_stream external_call external_define external_free ' +
      'window_handle window_device matrix_get matrix_set ' +
      'matrix_build_identity matrix_build matrix_build_lookat ' +
      'matrix_build_projection_ortho matrix_build_projection_perspective ' +
      'matrix_build_projection_perspective_fov matrix_multiply ' +
      'matrix_transform_vertex matrix_stack_push matrix_stack_pop ' +
      'matrix_stack_multiply matrix_stack_set matrix_stack_clear ' +
      'matrix_stack_top matrix_stack_is_empty browser_input_capture ' +
      'os_get_config os_get_info os_get_language os_get_region ' +
      'os_lock_orientation display_get_dpi_x display_get_dpi_y ' +
      'display_set_gui_size display_set_gui_maximise ' +
      'display_set_gui_maximize device_mouse_dbclick_enable ' +
      'display_set_timing_method display_get_timing_method ' +
      'display_set_sleep_margin display_get_sleep_margin virtual_key_add ' +
      'virtual_key_hide virtual_key_delete virtual_key_show ' +
      'draw_enable_drawevent draw_enable_swf_aa draw_set_swf_aa_level ' +
      'draw_get_swf_aa_level draw_texture_flush draw_flush ' +
      'gpu_set_blendenable gpu_set_ztestenable gpu_set_zfunc ' +
      'gpu_set_zwriteenable gpu_set_lightingenable gpu_set_fog ' +
      'gpu_set_cullmode gpu_set_blendmode gpu_set_blendmode_ext ' +
      'gpu_set_blendmode_ext_sepalpha gpu_set_colorwriteenable ' +
      'gpu_set_colourwriteenable gpu_set_alphatestenable ' +
      'gpu_set_alphatestref gpu_set_alphatestfunc gpu_set_texfilter ' +
      'gpu_set_texfilter_ext gpu_set_texrepeat gpu_set_texrepeat_ext ' +
      'gpu_set_tex_filter gpu_set_tex_filter_ext gpu_set_tex_repeat ' +
      'gpu_set_tex_repeat_ext gpu_set_tex_mip_filter ' +
      'gpu_set_tex_mip_filter_ext gpu_set_tex_mip_bias ' +
      'gpu_set_tex_mip_bias_ext gpu_set_tex_min_mip gpu_set_tex_min_mip_ext ' +
      'gpu_set_tex_max_mip gpu_set_tex_max_mip_ext gpu_set_tex_max_aniso ' +
      'gpu_set_tex_max_aniso_ext gpu_set_tex_mip_enable ' +
      'gpu_set_tex_mip_enable_ext gpu_get_blendenable gpu_get_ztestenable ' +
      'gpu_get_zfunc gpu_get_zwriteenable gpu_get_lightingenable ' +
      'gpu_get_fog gpu_get_cullmode gpu_get_blendmode gpu_get_blendmode_ext ' +
      'gpu_get_blendmode_ext_sepalpha gpu_get_blendmode_src ' +
      'gpu_get_blendmode_dest gpu_get_blendmode_srcalpha ' +
      'gpu_get_blendmode_destalpha gpu_get_colorwriteenable ' +
      'gpu_get_colourwriteenable gpu_get_alphatestenable ' +
      'gpu_get_alphatestref gpu_get_alphatestfunc gpu_get_texfilter ' +
      'gpu_get_texfilter_ext gpu_get_texrepeat gpu_get_texrepeat_ext ' +
      'gpu_get_tex_filter gpu_get_tex_filter_ext gpu_get_tex_repeat ' +
      'gpu_get_tex_repeat_ext gpu_get_tex_mip_filter ' +
      'gpu_get_tex_mip_filter_ext gpu_get_tex_mip_bias ' +
      'gpu_get_tex_mip_bias_ext gpu_get_tex_min_mip gpu_get_tex_min_mip_ext ' +
      'gpu_get_tex_max_mip gpu_get_tex_max_mip_ext gpu_get_tex_max_aniso ' +
      'gpu_get_tex_max_aniso_ext gpu_get_tex_mip_enable ' +
      'gpu_get_tex_mip_enable_ext gpu_push_state gpu_pop_state ' +
      'gpu_get_state gpu_set_state draw_light_define_ambient ' +
      'draw_light_define_direction draw_light_define_point ' +
      'draw_light_enable draw_set_lighting draw_light_get_ambient ' +
      'draw_light_get draw_get_lighting shop_leave_rating url_get_domain ' +
      'url_open url_open_ext url_open_full get_timer achievement_login ' +
      'achievement_logout achievement_post achievement_increment ' +
      'achievement_post_score achievement_available ' +
      'achievement_show_achievements achievement_show_leaderboards ' +
      'achievement_load_friends achievement_load_leaderboard ' +
      'achievement_send_challenge achievement_load_progress ' +
      'achievement_reset achievement_login_status achievement_get_pic ' +
      'achievement_show_challenge_notifications achievement_get_challenges ' +
      'achievement_event achievement_show achievement_get_info ' +
      'cloud_file_save cloud_string_save cloud_synchronise ads_enable ' +
      'ads_disable ads_setup ads_engagement_launch ads_engagement_available ' +
      'ads_engagement_active ads_event ads_event_preload ' +
      'ads_set_reward_callback ads_get_display_height ads_get_display_width ' +
      'ads_move ads_interstitial_available ads_interstitial_display ' +
      'device_get_tilt_x device_get_tilt_y device_get_tilt_z ' +
      'device_is_keypad_open device_mouse_check_button ' +
      'device_mouse_check_button_pressed device_mouse_check_button_released ' +
      'device_mouse_x device_mouse_y device_mouse_raw_x device_mouse_raw_y ' +
      'device_mouse_x_to_gui device_mouse_y_to_gui iap_activate iap_status ' +
      'iap_enumerate_products iap_restore_all iap_acquire iap_consume ' +
      'iap_product_details iap_purchase_details facebook_init ' +
      'facebook_login facebook_status facebook_graph_request ' +
      'facebook_dialog facebook_logout facebook_launch_offerwall ' +
      'facebook_post_message facebook_send_invite facebook_user_id ' +
      'facebook_accesstoken facebook_check_permission ' +
      'facebook_request_read_permissions ' +
      'facebook_request_publish_permissions gamepad_is_supported ' +
      'gamepad_get_device_count gamepad_is_connected ' +
      'gamepad_get_description gamepad_get_button_threshold ' +
      'gamepad_set_button_threshold gamepad_get_axis_deadzone ' +
      'gamepad_set_axis_deadzone gamepad_button_count gamepad_button_check ' +
      'gamepad_button_check_pressed gamepad_button_check_released ' +
      'gamepad_button_value gamepad_axis_count gamepad_axis_value ' +
      'gamepad_set_vibration gamepad_set_colour gamepad_set_color ' +
      'os_is_paused window_has_focus code_is_compiled http_get ' +
      'http_get_file http_post_string http_request json_encode json_decode ' +
      'zip_unzip load_csv base64_encode base64_decode md5_string_unicode ' +
      'md5_string_utf8 md5_file os_is_network_connected sha1_string_unicode ' +
      'sha1_string_utf8 sha1_file os_powersave_enable analytics_event ' +
      'analytics_event_ext win8_livetile_tile_notification ' +
      'win8_livetile_tile_clear win8_livetile_badge_notification ' +
      'win8_livetile_badge_clear win8_livetile_queue_enable ' +
      'win8_secondarytile_pin win8_secondarytile_badge_notification ' +
      'win8_secondarytile_delete win8_livetile_notification_begin ' +
      'win8_livetile_notification_secondary_begin ' +
      'win8_livetile_notification_expiry win8_livetile_notification_tag ' +
      'win8_livetile_notification_text_add ' +
      'win8_livetile_notification_image_add win8_livetile_notification_end ' +
      'win8_appbar_enable win8_appbar_add_element ' +
      'win8_appbar_remove_element win8_settingscharm_add_entry ' +
      'win8_settingscharm_add_html_entry win8_settingscharm_add_xaml_entry ' +
      'win8_settingscharm_set_xaml_property ' +
      'win8_settingscharm_get_xaml_property win8_settingscharm_remove_entry ' +
      'win8_share_image win8_share_screenshot win8_share_file ' +
      'win8_share_url win8_share_text win8_search_enable ' +
      'win8_search_disable win8_search_add_suggestions ' +
      'win8_device_touchscreen_available win8_license_initialize_sandbox ' +
      'win8_license_trial_version winphone_license_trial_version ' +
      'winphone_tile_title winphone_tile_count winphone_tile_back_title ' +
      'winphone_tile_back_content winphone_tile_back_content_wide ' +
      'winphone_tile_front_image winphone_tile_front_image_small ' +
      'winphone_tile_front_image_wide winphone_tile_back_image ' +
      'winphone_tile_back_image_wide winphone_tile_background_colour ' +
      'winphone_tile_background_color winphone_tile_icon_image ' +
      'winphone_tile_small_icon_image winphone_tile_wide_content ' +
      'winphone_tile_cycle_images winphone_tile_small_background_image ' +
      'physics_world_create physics_world_gravity ' +
      'physics_world_update_speed physics_world_update_iterations ' +
      'physics_world_draw_debug physics_pause_enable physics_fixture_create ' +
      'physics_fixture_set_kinematic physics_fixture_set_density ' +
      'physics_fixture_set_awake physics_fixture_set_restitution ' +
      'physics_fixture_set_friction physics_fixture_set_collision_group ' +
      'physics_fixture_set_sensor physics_fixture_set_linear_damping ' +
      'physics_fixture_set_angular_damping physics_fixture_set_circle_shape ' +
      'physics_fixture_set_box_shape physics_fixture_set_edge_shape ' +
      'physics_fixture_set_polygon_shape physics_fixture_set_chain_shape ' +
      'physics_fixture_add_point physics_fixture_bind ' +
      'physics_fixture_bind_ext physics_fixture_delete physics_apply_force ' +
      'physics_apply_impulse physics_apply_angular_impulse ' +
      'physics_apply_local_force physics_apply_local_impulse ' +
      'physics_apply_torque physics_mass_properties physics_draw_debug ' +
      'physics_test_overlap physics_remove_fixture physics_set_friction ' +
      'physics_set_density physics_set_restitution physics_get_friction ' +
      'physics_get_density physics_get_restitution ' +
      'physics_joint_distance_create physics_joint_rope_create ' +
      'physics_joint_revolute_create physics_joint_prismatic_create ' +
      'physics_joint_pulley_create physics_joint_wheel_create ' +
      'physics_joint_weld_create physics_joint_friction_create ' +
      'physics_joint_gear_create physics_joint_enable_motor ' +
      'physics_joint_get_value physics_joint_set_value physics_joint_delete ' +
      'physics_particle_create physics_particle_delete ' +
      'physics_particle_delete_region_circle ' +
      'physics_particle_delete_region_box ' +
      'physics_particle_delete_region_poly physics_particle_set_flags ' +
      'physics_particle_set_category_flags physics_particle_draw ' +
      'physics_particle_draw_ext physics_particle_count ' +
      'physics_particle_get_data physics_particle_get_data_particle ' +
      'physics_particle_group_begin physics_particle_group_circle ' +
      'physics_particle_group_box physics_particle_group_polygon ' +
      'physics_particle_group_add_point physics_particle_group_end ' +
      'physics_particle_group_join physics_particle_group_delete ' +
      'physics_particle_group_count physics_particle_group_get_data ' +
      'physics_particle_group_get_mass physics_particle_group_get_inertia ' +
      'physics_particle_group_get_centre_x ' +
      'physics_particle_group_get_centre_y physics_particle_group_get_vel_x ' +
      'physics_particle_group_get_vel_y physics_particle_group_get_ang_vel ' +
      'physics_particle_group_get_x physics_particle_group_get_y ' +
      'physics_particle_group_get_angle physics_particle_set_group_flags ' +
      'physics_particle_get_group_flags physics_particle_get_max_count ' +
      'physics_particle_get_radius physics_particle_get_density ' +
      'physics_particle_get_damping physics_particle_get_gravity_scale ' +
      'physics_particle_set_max_count physics_particle_set_radius ' +
      'physics_particle_set_density physics_particle_set_damping ' +
      'physics_particle_set_gravity_scale network_create_socket ' +
      'network_create_socket_ext network_create_server ' +
      'network_create_server_raw network_connect network_connect_raw ' +
      'network_send_packet network_send_raw network_send_broadcast ' +
      'network_send_udp network_send_udp_raw network_set_timeout ' +
      'network_set_config network_resolve network_destroy buffer_create ' +
      'buffer_write buffer_read buffer_seek buffer_get_surface ' +
      'buffer_set_surface buffer_delete buffer_exists buffer_get_type ' +
      'buffer_get_alignment buffer_poke buffer_peek buffer_save ' +
      'buffer_save_ext buffer_load buffer_load_ext buffer_load_partial ' +
      'buffer_copy buffer_fill buffer_get_size buffer_tell buffer_resize ' +
      'buffer_md5 buffer_sha1 buffer_base64_encode buffer_base64_decode ' +
      'buffer_base64_decode_ext buffer_sizeof buffer_get_address ' +
      'buffer_create_from_vertex_buffer ' +
      'buffer_create_from_vertex_buffer_ext buffer_copy_from_vertex_buffer ' +
      'buffer_async_group_begin buffer_async_group_option ' +
      'buffer_async_group_end buffer_load_async buffer_save_async ' +
      'gml_release_mode gml_pragma steam_activate_overlay ' +
      'steam_is_overlay_enabled steam_is_overlay_activated ' +
      'steam_get_persona_name steam_initialised ' +
      'steam_is_cloud_enabled_for_app steam_is_cloud_enabled_for_account ' +
      'steam_file_persisted steam_get_quota_total steam_get_quota_free ' +
      'steam_file_write steam_file_write_file steam_file_read ' +
      'steam_file_delete steam_file_exists steam_file_size steam_file_share ' +
      'steam_is_screenshot_requested steam_send_screenshot ' +
      'steam_is_user_logged_on steam_get_user_steam_id steam_user_owns_dlc ' +
      'steam_user_installed_dlc steam_set_achievement steam_get_achievement ' +
      'steam_clear_achievement steam_set_stat_int steam_set_stat_float ' +
      'steam_set_stat_avg_rate steam_get_stat_int steam_get_stat_float ' +
      'steam_get_stat_avg_rate steam_reset_all_stats ' +
      'steam_reset_all_stats_achievements steam_stats_ready ' +
      'steam_create_leaderboard steam_upload_score steam_upload_score_ext ' +
      'steam_download_scores_around_user steam_download_scores ' +
      'steam_download_friends_scores steam_upload_score_buffer ' +
      'steam_upload_score_buffer_ext steam_current_game_language ' +
      'steam_available_languages steam_activate_overlay_browser ' +
      'steam_activate_overlay_user steam_activate_overlay_store ' +
      'steam_get_user_persona_name steam_get_app_id ' +
      'steam_get_user_account_id steam_ugc_download steam_ugc_create_item ' +
      'steam_ugc_start_item_update steam_ugc_set_item_title ' +
      'steam_ugc_set_item_description steam_ugc_set_item_visibility ' +
      'steam_ugc_set_item_tags steam_ugc_set_item_content ' +
      'steam_ugc_set_item_preview steam_ugc_submit_item_update ' +
      'steam_ugc_get_item_update_progress steam_ugc_subscribe_item ' +
      'steam_ugc_unsubscribe_item steam_ugc_num_subscribed_items ' +
      'steam_ugc_get_subscribed_items steam_ugc_get_item_install_info ' +
      'steam_ugc_get_item_update_info steam_ugc_request_item_details ' +
      'steam_ugc_create_query_user steam_ugc_create_query_user_ex ' +
      'steam_ugc_create_query_all steam_ugc_create_query_all_ex ' +
      'steam_ugc_query_set_cloud_filename_filter ' +
      'steam_ugc_query_set_match_any_tag steam_ugc_query_set_search_text ' +
      'steam_ugc_query_set_ranked_by_trend_days ' +
      'steam_ugc_query_add_required_tag steam_ugc_query_add_excluded_tag ' +
      'steam_ugc_query_set_return_long_description ' +
      'steam_ugc_query_set_return_total_only ' +
      'steam_ugc_query_set_allow_cached_response steam_ugc_send_query ' +
      'shader_set shader_reset shader_current shader_is_compiled ' +
      'shader_get_sampler_index shader_get_uniform shader_set_uniform_i ' +
      'shader_set_uniform_i_array shader_set_uniform_f ' +
      'shader_set_uniform_f_array shader_set_uniform_matrix ' +
      'shader_set_uniform_matrix_array shader_enable_corner_id ' +
      'texture_set_stage texture_get_texel_width texture_get_texel_height ' +
      'shaders_are_supported vertex_format_begin vertex_format_end ' +
      'vertex_format_delete vertex_format_add_position ' +
      'vertex_format_add_position_3d vertex_format_add_colour ' +
      'vertex_format_add_color vertex_format_add_normal ' +
      'vertex_format_add_texcoord vertex_format_add_textcoord ' +
      'vertex_format_add_custom vertex_create_buffer ' +
      'vertex_create_buffer_ext vertex_delete_buffer vertex_begin ' +
      'vertex_end vertex_position vertex_position_3d vertex_colour ' +
      'vertex_color vertex_argb vertex_texcoord vertex_normal vertex_float1 ' +
      'vertex_float2 vertex_float3 vertex_float4 vertex_ubyte4 ' +
      'vertex_submit vertex_freeze vertex_get_number vertex_get_buffer_size ' +
      'vertex_create_buffer_from_buffer ' +
      'vertex_create_buffer_from_buffer_ext push_local_notification ' +
      'push_get_first_local_notification push_get_next_local_notification ' +
      'push_cancel_local_notification skeleton_animation_set ' +
      'skeleton_animation_get skeleton_animation_mix ' +
      'skeleton_animation_set_ext skeleton_animation_get_ext ' +
      'skeleton_animation_get_duration skeleton_animation_get_frames ' +
      'skeleton_animation_clear skeleton_skin_set skeleton_skin_get ' +
      'skeleton_attachment_set skeleton_attachment_get ' +
      'skeleton_attachment_create skeleton_collision_draw_set ' +
      'skeleton_bone_data_get skeleton_bone_data_set ' +
      'skeleton_bone_state_get skeleton_bone_state_set skeleton_get_minmax ' +
      'skeleton_get_num_bounds skeleton_get_bounds ' +
      'skeleton_animation_get_frame skeleton_animation_set_frame ' +
      'draw_skeleton draw_skeleton_time draw_skeleton_instance ' +
      'draw_skeleton_collision skeleton_animation_list skeleton_skin_list ' +
      'skeleton_slot_data layer_get_id layer_get_id_at_depth ' +
      'layer_get_depth layer_create layer_destroy layer_destroy_instances ' +
      'layer_add_instance layer_has_instance layer_set_visible ' +
      'layer_get_visible layer_exists layer_x layer_y layer_get_x ' +
      'layer_get_y layer_hspeed layer_vspeed layer_get_hspeed ' +
      'layer_get_vspeed layer_script_begin layer_script_end layer_shader ' +
      'layer_get_script_begin layer_get_script_end layer_get_shader ' +
      'layer_set_target_room layer_get_target_room layer_reset_target_room ' +
      'layer_get_all layer_get_all_elements layer_get_name layer_depth ' +
      'layer_get_element_layer layer_get_element_type layer_element_move ' +
      'layer_force_draw_depth layer_is_draw_depth_forced ' +
      'layer_get_forced_depth layer_background_get_id ' +
      'layer_background_exists layer_background_create ' +
      'layer_background_destroy layer_background_visible ' +
      'layer_background_change layer_background_sprite ' +
      'layer_background_htiled layer_background_vtiled ' +
      'layer_background_stretch layer_background_yscale ' +
      'layer_background_xscale layer_background_blend ' +
      'layer_background_alpha layer_background_index layer_background_speed ' +
      'layer_background_get_visible layer_background_get_sprite ' +
      'layer_background_get_htiled layer_background_get_vtiled ' +
      'layer_background_get_stretch layer_background_get_yscale ' +
      'layer_background_get_xscale layer_background_get_blend ' +
      'layer_background_get_alpha layer_background_get_index ' +
      'layer_background_get_speed layer_sprite_get_id layer_sprite_exists ' +
      'layer_sprite_create layer_sprite_destroy layer_sprite_change ' +
      'layer_sprite_index layer_sprite_speed layer_sprite_xscale ' +
      'layer_sprite_yscale layer_sprite_angle layer_sprite_blend ' +
      'layer_sprite_alpha layer_sprite_x layer_sprite_y ' +
      'layer_sprite_get_sprite layer_sprite_get_index ' +
      'layer_sprite_get_speed layer_sprite_get_xscale ' +
      'layer_sprite_get_yscale layer_sprite_get_angle ' +
      'layer_sprite_get_blend layer_sprite_get_alpha layer_sprite_get_x ' +
      'layer_sprite_get_y layer_tilemap_get_id layer_tilemap_exists ' +
      'layer_tilemap_create layer_tilemap_destroy tilemap_tileset tilemap_x ' +
      'tilemap_y tilemap_set tilemap_set_at_pixel tilemap_get_tileset ' +
      'tilemap_get_tile_width tilemap_get_tile_height tilemap_get_width ' +
      'tilemap_get_height tilemap_get_x tilemap_get_y tilemap_get ' +
      'tilemap_get_at_pixel tilemap_get_cell_x_at_pixel ' +
      'tilemap_get_cell_y_at_pixel tilemap_clear draw_tilemap draw_tile ' +
      'tilemap_set_global_mask tilemap_get_global_mask tilemap_set_mask ' +
      'tilemap_get_mask tilemap_get_frame tile_set_empty tile_set_index ' +
      'tile_set_flip tile_set_mirror tile_set_rotate tile_get_empty ' +
      'tile_get_index tile_get_flip tile_get_mirror tile_get_rotate ' +
      'layer_tile_exists layer_tile_create layer_tile_destroy ' +
      'layer_tile_change layer_tile_xscale layer_tile_yscale ' +
      'layer_tile_blend layer_tile_alpha layer_tile_x layer_tile_y ' +
      'layer_tile_region layer_tile_visible layer_tile_get_sprite ' +
      'layer_tile_get_xscale layer_tile_get_yscale layer_tile_get_blend ' +
      'layer_tile_get_alpha layer_tile_get_x layer_tile_get_y ' +
      'layer_tile_get_region layer_tile_get_visible ' +
      'layer_instance_get_instance instance_activate_layer ' +
      'instance_deactivate_layer camera_create camera_create_view ' +
      'camera_destroy camera_apply camera_get_active camera_get_default ' +
      'camera_set_default camera_set_view_mat camera_set_proj_mat ' +
      'camera_set_update_script camera_set_begin_script ' +
      'camera_set_end_script camera_set_view_pos camera_set_view_size ' +
      'camera_set_view_speed camera_set_view_border camera_set_view_angle ' +
      'camera_set_view_target camera_get_view_mat camera_get_proj_mat ' +
      'camera_get_update_script camera_get_begin_script ' +
      'camera_get_end_script camera_get_view_x camera_get_view_y ' +
      'camera_get_view_width camera_get_view_height camera_get_view_speed_x ' +
      'camera_get_view_speed_y camera_get_view_border_x ' +
      'camera_get_view_border_y camera_get_view_angle ' +
      'camera_get_view_target view_get_camera view_get_visible ' +
      'view_get_xport view_get_yport view_get_wport view_get_hport ' +
      'view_get_surface_id view_set_camera view_set_visible view_set_xport ' +
      'view_set_yport view_set_wport view_set_hport view_set_surface_id ' +
      'gesture_drag_time gesture_drag_distance gesture_flick_speed ' +
      'gesture_double_tap_time gesture_double_tap_distance ' +
      'gesture_pinch_distance gesture_pinch_angle_towards ' +
      'gesture_pinch_angle_away gesture_rotate_time gesture_rotate_angle ' +
      'gesture_tap_count gesture_get_drag_time gesture_get_drag_distance ' +
      'gesture_get_flick_speed gesture_get_double_tap_time ' +
      'gesture_get_double_tap_distance gesture_get_pinch_distance ' +
      'gesture_get_pinch_angle_towards gesture_get_pinch_angle_away ' +
      'gesture_get_rotate_time gesture_get_rotate_angle gesture_get_tap_count',
    literal: 'self other all noone global local undefined pointer_invalid ' +
      'pointer_null path_action_stop path_action_restart ' +
      'path_action_continue path_action_reverse true false pi GM_build_date ' +
      'GM_version GM_runtime_version  timezone_local timezone_utc ' +
      'gamespeed_fps gamespeed_microseconds  ev_create ev_destroy ev_step ' +
      'ev_alarm ev_keyboard ev_mouse ev_collision ev_other ev_draw ' +
      'ev_draw_begin ev_draw_end ev_draw_pre ev_draw_post ev_keypress ' +
      'ev_keyrelease ev_trigger ev_left_button ev_right_button ' +
      'ev_middle_button ev_no_button ev_left_press ev_right_press ' +
      'ev_middle_press ev_left_release ev_right_release ev_middle_release ' +
      'ev_mouse_enter ev_mouse_leave ev_mouse_wheel_up ev_mouse_wheel_down ' +
      'ev_global_left_button ev_global_right_button ev_global_middle_button ' +
      'ev_global_left_press ev_global_right_press ev_global_middle_press ' +
      'ev_global_left_release ev_global_right_release ' +
      'ev_global_middle_release ev_joystick1_left ev_joystick1_right ' +
      'ev_joystick1_up ev_joystick1_down ev_joystick1_button1 ' +
      'ev_joystick1_button2 ev_joystick1_button3 ev_joystick1_button4 ' +
      'ev_joystick1_button5 ev_joystick1_button6 ev_joystick1_button7 ' +
      'ev_joystick1_button8 ev_joystick2_left ev_joystick2_right ' +
      'ev_joystick2_up ev_joystick2_down ev_joystick2_button1 ' +
      'ev_joystick2_button2 ev_joystick2_button3 ev_joystick2_button4 ' +
      'ev_joystick2_button5 ev_joystick2_button6 ev_joystick2_button7 ' +
      'ev_joystick2_button8 ev_outside ev_boundary ev_game_start ' +
      'ev_game_end ev_room_start ev_room_end ev_no_more_lives ' +
      'ev_animation_end ev_end_of_path ev_no_more_health ev_close_button ' +
      'ev_user0 ev_user1 ev_user2 ev_user3 ev_user4 ev_user5 ev_user6 ' +
      'ev_user7 ev_user8 ev_user9 ev_user10 ev_user11 ev_user12 ev_user13 ' +
      'ev_user14 ev_user15 ev_step_normal ev_step_begin ev_step_end ev_gui ' +
      'ev_gui_begin ev_gui_end ev_gesture ev_gesture_tap ' +
      'ev_gesture_double_tap ev_gesture_drag_start ev_gesture_dragging ' +
      'ev_gesture_drag_end ev_gesture_flick ev_gesture_pinch_start ' +
      'ev_gesture_pinch_in ev_gesture_pinch_out ev_gesture_pinch_end ' +
      'ev_gesture_rotate_start ev_gesture_rotating ev_gesture_rotate_end ' +
      'ev_global_gesture_tap ev_global_gesture_double_tap ' +
      'ev_global_gesture_drag_start ev_global_gesture_dragging ' +
      'ev_global_gesture_drag_end ev_global_gesture_flick ' +
      'ev_global_gesture_pinch_start ev_global_gesture_pinch_in ' +
      'ev_global_gesture_pinch_out ev_global_gesture_pinch_end ' +
      'ev_global_gesture_rotate_start ev_global_gesture_rotating ' +
      'ev_global_gesture_rotate_end vk_nokey vk_anykey vk_enter vk_return ' +
      'vk_shift vk_control vk_alt vk_escape vk_space vk_backspace vk_tab ' +
      'vk_pause vk_printscreen vk_left vk_right vk_up vk_down vk_home ' +
      'vk_end vk_delete vk_insert vk_pageup vk_pagedown vk_f1 vk_f2 vk_f3 ' +
      'vk_f4 vk_f5 vk_f6 vk_f7 vk_f8 vk_f9 vk_f10 vk_f11 vk_f12 vk_numpad0 ' +
      'vk_numpad1 vk_numpad2 vk_numpad3 vk_numpad4 vk_numpad5 vk_numpad6 ' +
      'vk_numpad7 vk_numpad8 vk_numpad9 vk_divide vk_multiply vk_subtract ' +
      'vk_add vk_decimal vk_lshift vk_lcontrol vk_lalt vk_rshift ' +
      'vk_rcontrol vk_ralt  mb_any mb_none mb_left mb_right mb_middle ' +
      'c_aqua c_black c_blue c_dkgray c_fuchsia c_gray c_green c_lime ' +
      'c_ltgray c_maroon c_navy c_olive c_purple c_red c_silver c_teal ' +
      'c_white c_yellow c_orange fa_left fa_center fa_right fa_top ' +
      'fa_middle fa_bottom pr_pointlist pr_linelist pr_linestrip ' +
      'pr_trianglelist pr_trianglestrip pr_trianglefan bm_complex bm_normal ' +
      'bm_add bm_max bm_subtract bm_zero bm_one bm_src_colour ' +
      'bm_inv_src_colour bm_src_color bm_inv_src_color bm_src_alpha ' +
      'bm_inv_src_alpha bm_dest_alpha bm_inv_dest_alpha bm_dest_colour ' +
      'bm_inv_dest_colour bm_dest_color bm_inv_dest_color bm_src_alpha_sat ' +
      'tf_point tf_linear tf_anisotropic mip_off mip_on mip_markedonly ' +
      'audio_falloff_none audio_falloff_inverse_distance ' +
      'audio_falloff_inverse_distance_clamped audio_falloff_linear_distance ' +
      'audio_falloff_linear_distance_clamped ' +
      'audio_falloff_exponent_distance ' +
      'audio_falloff_exponent_distance_clamped audio_old_system ' +
      'audio_new_system audio_mono audio_stereo audio_3d cr_default cr_none ' +
      'cr_arrow cr_cross cr_beam cr_size_nesw cr_size_ns cr_size_nwse ' +
      'cr_size_we cr_uparrow cr_hourglass cr_drag cr_appstart cr_handpoint ' +
      'cr_size_all spritespeed_framespersecond ' +
      'spritespeed_framespergameframe asset_object asset_unknown ' +
      'asset_sprite asset_sound asset_room asset_path asset_script ' +
      'asset_font asset_timeline asset_tiles asset_shader fa_readonly ' +
      'fa_hidden fa_sysfile fa_volumeid fa_directory fa_archive  ' +
      'ds_type_map ds_type_list ds_type_stack ds_type_queue ds_type_grid ' +
      'ds_type_priority ef_explosion ef_ring ef_ellipse ef_firework ' +
      'ef_smoke ef_smokeup ef_star ef_spark ef_flare ef_cloud ef_rain ' +
      'ef_snow pt_shape_pixel pt_shape_disk pt_shape_square pt_shape_line ' +
      'pt_shape_star pt_shape_circle pt_shape_ring pt_shape_sphere ' +
      'pt_shape_flare pt_shape_spark pt_shape_explosion pt_shape_cloud ' +
      'pt_shape_smoke pt_shape_snow ps_distr_linear ps_distr_gaussian ' +
      'ps_distr_invgaussian ps_shape_rectangle ps_shape_ellipse ' +
      'ps_shape_diamond ps_shape_line ty_real ty_string dll_cdecl ' +
      'dll_stdcall matrix_view matrix_projection matrix_world os_win32 ' +
      'os_windows os_macosx os_ios os_android os_symbian os_linux ' +
      'os_unknown os_winphone os_tizen os_win8native os_wiiu os_3ds ' +
      'os_psvita os_bb10 os_ps4 os_xboxone os_ps3 os_xbox360 os_uwp ' +
      'browser_not_a_browser browser_unknown browser_ie browser_firefox ' +
      'browser_chrome browser_safari browser_safari_mobile browser_opera ' +
      'browser_tizen browser_edge browser_windows_store browser_ie_mobile  ' +
      'device_ios_unknown device_ios_iphone device_ios_iphone_retina ' +
      'device_ios_ipad device_ios_ipad_retina device_ios_iphone5 ' +
      'device_ios_iphone6 device_ios_iphone6plus device_emulator ' +
      'device_tablet display_landscape display_landscape_flipped ' +
      'display_portrait display_portrait_flipped tm_sleep tm_countvsyncs ' +
      'of_challenge_win of_challen ge_lose of_challenge_tie ' +
      'leaderboard_type_number leaderboard_type_time_mins_secs ' +
      'cmpfunc_never cmpfunc_less cmpfunc_equal cmpfunc_lessequal ' +
      'cmpfunc_greater cmpfunc_notequal cmpfunc_greaterequal cmpfunc_always ' +
      'cull_noculling cull_clockwise cull_counterclockwise lighttype_dir ' +
      'lighttype_point iap_ev_storeload iap_ev_product iap_ev_purchase ' +
      'iap_ev_consume iap_ev_restore iap_storeload_ok iap_storeload_failed ' +
      'iap_status_uninitialised iap_status_unavailable iap_status_loading ' +
      'iap_status_available iap_status_processing iap_status_restoring ' +
      'iap_failed iap_unavailable iap_available iap_purchased iap_canceled ' +
      'iap_refunded fb_login_default fb_login_fallback_to_webview ' +
      'fb_login_no_fallback_to_webview fb_login_forcing_webview ' +
      'fb_login_use_system_account fb_login_forcing_safari  ' +
      'phy_joint_anchor_1_x phy_joint_anchor_1_y phy_joint_anchor_2_x ' +
      'phy_joint_anchor_2_y phy_joint_reaction_force_x ' +
      'phy_joint_reaction_force_y phy_joint_reaction_torque ' +
      'phy_joint_motor_speed phy_joint_angle phy_joint_motor_torque ' +
      'phy_joint_max_motor_torque phy_joint_translation phy_joint_speed ' +
      'phy_joint_motor_force phy_joint_max_motor_force phy_joint_length_1 ' +
      'phy_joint_length_2 phy_joint_damping_ratio phy_joint_frequency ' +
      'phy_joint_lower_angle_limit phy_joint_upper_angle_limit ' +
      'phy_joint_angle_limits phy_joint_max_length phy_joint_max_torque ' +
      'phy_joint_max_force phy_debug_render_aabb ' +
      'phy_debug_render_collision_pairs phy_debug_render_coms ' +
      'phy_debug_render_core_shapes phy_debug_render_joints ' +
      'phy_debug_render_obb phy_debug_render_shapes  ' +
      'phy_particle_flag_water phy_particle_flag_zombie ' +
      'phy_particle_flag_wall phy_particle_flag_spring ' +
      'phy_particle_flag_elastic phy_particle_flag_viscous ' +
      'phy_particle_flag_powder phy_particle_flag_tensile ' +
      'phy_particle_flag_colourmixing phy_particle_flag_colormixing ' +
      'phy_particle_group_flag_solid phy_particle_group_flag_rigid ' +
      'phy_particle_data_flag_typeflags phy_particle_data_flag_position ' +
      'phy_particle_data_flag_velocity phy_particle_data_flag_colour ' +
      'phy_particle_data_flag_color phy_particle_data_flag_category  ' +
      'achievement_our_info achievement_friends_info ' +
      'achievement_leaderboard_info achievement_achievement_info ' +
      'achievement_filter_all_players achievement_filter_friends_only ' +
      'achievement_filter_favorites_only ' +
      'achievement_type_achievement_challenge ' +
      'achievement_type_score_challenge achievement_pic_loaded  ' +
      'achievement_show_ui achievement_show_profile ' +
      'achievement_show_leaderboard achievement_show_achievement ' +
      'achievement_show_bank achievement_show_friend_picker ' +
      'achievement_show_purchase_prompt network_socket_tcp ' +
      'network_socket_udp network_socket_bluetooth network_type_connect ' +
      'network_type_disconnect network_type_data ' +
      'network_type_non_blocking_connect network_config_connect_timeout ' +
      'network_config_use_non_blocking_socket ' +
      'network_config_enable_reliable_udp ' +
      'network_config_disable_reliable_udp buffer_fixed buffer_grow ' +
      'buffer_wrap buffer_fast buffer_vbuffer buffer_network buffer_u8 ' +
      'buffer_s8 buffer_u16 buffer_s16 buffer_u32 buffer_s32 buffer_u64 ' +
      'buffer_f16 buffer_f32 buffer_f64 buffer_bool buffer_text ' +
      'buffer_string buffer_seek_start buffer_seek_relative buffer_seek_end ' +
      'buffer_generalerror buffer_outofspace buffer_outofbounds ' +
      'buffer_invalidtype  text_type button_type input_type ANSI_CHARSET ' +
      'DEFAULT_CHARSET EASTEUROPE_CHARSET RUSSIAN_CHARSET SYMBOL_CHARSET ' +
      'SHIFTJIS_CHARSET HANGEUL_CHARSET GB2312_CHARSET CHINESEBIG5_CHARSET ' +
      'JOHAB_CHARSET HEBREW_CHARSET ARABIC_CHARSET GREEK_CHARSET ' +
      'TURKISH_CHARSET VIETNAMESE_CHARSET THAI_CHARSET MAC_CHARSET ' +
      'BALTIC_CHARSET OEM_CHARSET  gp_face1 gp_face2 gp_face3 gp_face4 ' +
      'gp_shoulderl gp_shoulderr gp_shoulderlb gp_shoulderrb gp_select ' +
      'gp_start gp_stickl gp_stickr gp_padu gp_padd gp_padl gp_padr ' +
      'gp_axislh gp_axislv gp_axisrh gp_axisrv ov_friends ov_community ' +
      'ov_players ov_settings ov_gamegroup ov_achievements lb_sort_none ' +
      'lb_sort_ascending lb_sort_descending lb_disp_none lb_disp_numeric ' +
      'lb_disp_time_sec lb_disp_time_ms ugc_result_success ' +
      'ugc_filetype_community ugc_filetype_microtrans ugc_visibility_public ' +
      'ugc_visibility_friends_only ugc_visibility_private ' +
      'ugc_query_RankedByVote ugc_query_RankedByPublicationDate ' +
      'ugc_query_AcceptedForGameRankedByAcceptanceDate ' +
      'ugc_query_RankedByTrend ' +
      'ugc_query_FavoritedByFriendsRankedByPublicationDate ' +
      'ugc_query_CreatedByFriendsRankedByPublicationDate ' +
      'ugc_query_RankedByNumTimesReported ' +
      'ugc_query_CreatedByFollowedUsersRankedByPublicationDate ' +
      'ugc_query_NotYetRated ugc_query_RankedByTotalVotesAsc ' +
      'ugc_query_RankedByVotesUp ugc_query_RankedByTextSearch ' +
      'ugc_sortorder_CreationOrderDesc ugc_sortorder_CreationOrderAsc ' +
      'ugc_sortorder_TitleAsc ugc_sortorder_LastUpdatedDesc ' +
      'ugc_sortorder_SubscriptionDateDesc ugc_sortorder_VoteScoreDesc ' +
      'ugc_sortorder_ForModeration ugc_list_Published ugc_list_VotedOn ' +
      'ugc_list_VotedUp ugc_list_VotedDown ugc_list_WillVoteLater ' +
      'ugc_list_Favorited ugc_list_Subscribed ugc_list_UsedOrPlayed ' +
      'ugc_list_Followed ugc_match_Items ugc_match_Items_Mtx ' +
      'ugc_match_Items_ReadyToUse ugc_match_Collections ugc_match_Artwork ' +
      'ugc_match_Videos ugc_match_Screenshots ugc_match_AllGuides ' +
      'ugc_match_WebGuides ugc_match_IntegratedGuides ' +
      'ugc_match_UsableInGame ugc_match_ControllerBindings  ' +
      'vertex_usage_position vertex_usage_colour vertex_usage_color ' +
      'vertex_usage_normal vertex_usage_texcoord vertex_usage_textcoord ' +
      'vertex_usage_blendweight vertex_usage_blendindices ' +
      'vertex_usage_psize vertex_usage_tangent vertex_usage_binormal ' +
      'vertex_usage_fog vertex_usage_depth vertex_usage_sample ' +
      'vertex_type_float1 vertex_type_float2 vertex_type_float3 ' +
      'vertex_type_float4 vertex_type_colour vertex_type_color ' +
      'vertex_type_ubyte4 layerelementtype_undefined ' +
      'layerelementtype_background layerelementtype_instance ' +
      'layerelementtype_oldtilemap layerelementtype_sprite ' +
      'layerelementtype_tilemap layerelementtype_particlesystem ' +
      'layerelementtype_tile tile_rotate tile_flip tile_mirror ' +
      'tile_index_mask ',
    symbol: 'argument_relative argument argument0 argument1 argument2 ' +
      'argument3 argument4 argument5 argument6 argument7 argument8 ' +
      'argument9 argument10 argument11 argument12 argument13 argument14 ' +
      'argument15 argument_count x y xprevious yprevious xstart ystart ' +
      'hspeed vspeed direction speed friction gravity gravity_direction ' +
      'path_index path_position path_positionprevious path_speed ' +
      'path_scale path_orientation path_endaction object_index id solid ' +
      'persistent mask_index instance_count instance_id room_speed fps ' +
      'fps_real current_time current_year current_month current_day ' +
      'current_weekday current_hour current_minute current_second alarm ' +
      'timeline_index timeline_position timeline_speed timeline_running ' +
      'timeline_loop room room_first room_last room_width room_height ' +
      'room_caption room_persistent score lives health show_score ' +
      'show_lives show_health caption_score caption_lives caption_health ' +
      'event_type event_number event_object event_action ' +
      'application_surface gamemaker_pro gamemaker_registered ' +
      'gamemaker_version error_occurred error_last debug_mode ' +
      'keyboard_key keyboard_lastkey keyboard_lastchar keyboard_string ' +
      'mouse_x mouse_y mouse_button mouse_lastbutton cursor_sprite ' +
      'visible sprite_index sprite_width sprite_height sprite_xoffset ' +
      'sprite_yoffset image_number image_index image_speed depth ' +
      'image_xscale image_yscale image_angle image_alpha image_blend ' +
      'bbox_left bbox_right bbox_top bbox_bottom layer background_colour  ' +
      'background_showcolour background_color background_showcolor ' +
      'view_enabled view_current view_visible view_xview view_yview ' +
      'view_wview view_hview view_xport view_yport view_wport view_hport ' +
      'view_angle view_hborder view_vborder view_hspeed view_vspeed ' +
      'view_object view_surface_id view_camera game_id game_display_name ' +
      'game_project_name game_save_id working_directory temp_directory ' +
      'program_directory browser_width browser_height os_type os_device ' +
      'os_browser os_version display_aa async_load delta_time ' +
      'webgl_enabled event_data iap_data phy_rotation phy_position_x ' +
      'phy_position_y phy_angular_velocity phy_linear_velocity_x ' +
      'phy_linear_velocity_y phy_speed_x phy_speed_y phy_speed ' +
      'phy_angular_damping phy_linear_damping phy_bullet ' +
      'phy_fixed_rotation phy_active phy_mass phy_inertia phy_com_x ' +
      'phy_com_y phy_dynamic phy_kinematic phy_sleeping ' +
      'phy_collision_points phy_collision_x phy_collision_y ' +
      'phy_col_normal_x phy_col_normal_y phy_position_xprevious ' +
      'phy_position_yprevious'
  };
  
  return {
    aliases: ['gml', 'GML'],
    case_insensitive: false, // language is case-insensitive
    keywords: GML_KEYWORDS,

    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE,
      hljs.C_NUMBER_MODE
    ]
  };
});

hljs.registerLanguage('javascript', function(hljs) {
  var IDENT_RE = '[A-Za-z$_][0-9A-Za-z$_]*';
  var KEYWORDS = {
    keyword:
      'in of if for while finally var new function do return void else break catch ' +
      'instanceof with throw case default try this switch continue typeof delete ' +
      'let yield const export super debugger as async await static ' +
      // ECMAScript 6 modules import
      'import from as'
    ,
    literal:
      'true false null undefined NaN Infinity',
    built_in:
      'eval isFinite isNaN parseFloat parseInt decodeURI decodeURIComponent ' +
      'encodeURI encodeURIComponent escape unescape Object Function Boolean Error ' +
      'EvalError InternalError RangeError ReferenceError StopIteration SyntaxError ' +
      'TypeError URIError Number Math Date String RegExp Array Float32Array ' +
      'Float64Array Int16Array Int32Array Int8Array Uint16Array Uint32Array ' +
      'Uint8Array Uint8ClampedArray ArrayBuffer DataView JSON Intl arguments require ' +
      'module console window document Symbol Set Map WeakSet WeakMap Proxy Reflect ' +
      'Promise'
  };
  var EXPRESSIONS;
  var NUMBER = {
    className: 'number',
    variants: [
      { begin: '\\b(0[bB][01]+)' },
      { begin: '\\b(0[oO][0-7]+)' },
      { begin: hljs.C_NUMBER_RE }
    ],
    relevance: 0
  };
  var SUBST = {
    className: 'subst',
    begin: '\\$\\{', end: '\\}',
    keywords: KEYWORDS,
    contains: []  // defined later
  };
  var TEMPLATE_STRING = {
    className: 'string',
    begin: '`', end: '`',
    contains: [
      hljs.BACKSLASH_ESCAPE,
      SUBST
    ]
  };
  SUBST.contains = [
    hljs.APOS_STRING_MODE,
    hljs.QUOTE_STRING_MODE,
    TEMPLATE_STRING,
    NUMBER,
    hljs.REGEXP_MODE
  ]
  var PARAMS_CONTAINS = SUBST.contains.concat([
    hljs.C_BLOCK_COMMENT_MODE,
    hljs.C_LINE_COMMENT_MODE
  ]);

  return {
    aliases: ['js', 'jsx'],
    keywords: KEYWORDS,
    contains: [
      {
        className: 'meta',
        relevance: 10,
        begin: /^\s*['"]use (strict|asm)['"]/
      },
      {
        className: 'meta',
        begin: /^#!/, end: /$/
      },
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE,
      TEMPLATE_STRING,
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      NUMBER,
      { // object attr container
        begin: /[{,]\s*/, relevance: 0,
        contains: [
          {
            begin: IDENT_RE + '\\s*:', returnBegin: true,
            relevance: 0,
            contains: [{className: 'attr', begin: IDENT_RE, relevance: 0}]
          }
        ]
      },
      { // "value" container
        begin: '(' + hljs.RE_STARTERS_RE + '|\\b(case|return|throw)\\b)\\s*',
        keywords: 'return throw case',
        contains: [
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          hljs.REGEXP_MODE,
          {
            className: 'function',
            begin: '(\\(.*?\\)|' + IDENT_RE + ')\\s*=>', returnBegin: true,
            end: '\\s*=>',
            contains: [
              {
                className: 'params',
                variants: [
                  {
                    begin: IDENT_RE
                  },
                  {
                    begin: /\(\s*\)/,
                  },
                  {
                    begin: /\(/, end: /\)/,
                    excludeBegin: true, excludeEnd: true,
                    keywords: KEYWORDS,
                    contains: PARAMS_CONTAINS
                  }
                ]
              }
            ]
          },
          { // E4X / JSX
            begin: /</, end: /(\/\w+|\w+\/)>/,
            subLanguage: 'xml',
            contains: [
              {begin: /<\w+\s*\/>/, skip: true},
              {
                begin: /<\w+/, end: /(\/\w+|\w+\/)>/, skip: true,
                contains: [
                  {begin: /<\w+\s*\/>/, skip: true},
                  'self'
                ]
              }
            ]
          }
        ],
        relevance: 0
      },
      {
        className: 'function',
        beginKeywords: 'function', end: /\{/, excludeEnd: true,
        contains: [
          hljs.inherit(hljs.TITLE_MODE, {begin: IDENT_RE}),
          {
            className: 'params',
            begin: /\(/, end: /\)/,
            excludeBegin: true,
            excludeEnd: true,
            contains: PARAMS_CONTAINS
          }
        ],
        illegal: /\[|%/
      },
      {
        begin: /\$[(.]/ // relevance booster for a pattern common to JS libs: `$(something)` and `$.something`
      },
      hljs.METHOD_GUARD,
      { // ES6 class
        className: 'class',
        beginKeywords: 'class', end: /[{;=]/, excludeEnd: true,
        illegal: /[:"\[\]]/,
        contains: [
          {beginKeywords: 'extends'},
          hljs.UNDERSCORE_TITLE_MODE
        ]
      },
      {
        beginKeywords: 'constructor', end: /\{/, excludeEnd: true
      }
    ],
    illegal: /#(?!!)/
  };
});

hljs.registerLanguage('json', function(hljs) {
  var LITERALS = {literal: 'true false null'};
  var TYPES = [
    hljs.QUOTE_STRING_MODE,
    hljs.C_NUMBER_MODE
  ];
  var VALUE_CONTAINER = {
    end: ',', endsWithParent: true, excludeEnd: true,
    contains: TYPES,
    keywords: LITERALS
  };
  var OBJECT = {
    begin: '{', end: '}',
    contains: [
      {
        className: 'attr',
        begin: /"/, end: /"/,
        contains: [hljs.BACKSLASH_ESCAPE],
        illegal: '\\n',
      },
      hljs.inherit(VALUE_CONTAINER, {begin: /:/})
    ],
    illegal: '\\S'
  };
  var ARRAY = {
    begin: '\\[', end: '\\]',
    contains: [hljs.inherit(VALUE_CONTAINER)], // inherit is a workaround for a bug that makes shared modes with endsWithParent compile only the ending of one of the parents
    illegal: '\\S'
  };
  TYPES.splice(TYPES.length, 0, OBJECT, ARRAY);
  return {
    contains: TYPES,
    keywords: LITERALS,
    illegal: '\\S'
  };
});

hljs.registerLanguage('xml', function(hljs) {
  var XML_IDENT_RE = '[A-Za-z0-9\\._:-]+';
  var TAG_INTERNALS = {
    endsWithParent: true,
    illegal: /</,
    relevance: 0,
    contains: [
      {
        className: 'attr',
        begin: XML_IDENT_RE,
        relevance: 0
      },
      {
        begin: /=\s*/,
        relevance: 0,
        contains: [
          {
            className: 'string',
            endsParent: true,
            variants: [
              {begin: /"/, end: /"/},
              {begin: /'/, end: /'/},
              {begin: /[^\s"'=<>`]+/}
            ]
          }
        ]
      }
    ]
  };
  return {
    aliases: ['html', 'xhtml', 'rss', 'atom', 'xjb', 'xsd', 'xsl', 'plist'],
    case_insensitive: true,
    contains: [
      {
        className: 'meta',
        begin: '<!DOCTYPE', end: '>',
        relevance: 10,
        contains: [{begin: '\\[', end: '\\]'}]
      },
      hljs.COMMENT(
        '<!--',
        '-->',
        {
          relevance: 10
        }
      ),
      {
        begin: '<\\!\\[CDATA\\[', end: '\\]\\]>',
        relevance: 10
      },
      {
        className: 'meta',
        begin: /<\?xml/, end: /\?>/, relevance: 10
      },
      {
        begin: /<\?(php)?/, end: /\?>/,
        subLanguage: 'php',
        contains: [{begin: '/\\*', end: '\\*/', skip: true}]
      },
      {
        className: 'tag',
        /*
        The lookahead pattern (?=...) ensures that 'begin' only matches
        '<style' as a single word, followed by a whitespace or an
        ending braket. The '$' is needed for the lexeme to be recognized
        by hljs.subMode() that tests lexemes outside the stream.
        */
        begin: '<style(?=\\s|>|$)', end: '>',
        keywords: {name: 'style'},
        contains: [TAG_INTERNALS],
        starts: {
          end: '</style>', returnEnd: true,
          subLanguage: ['css', 'xml']
        }
      },
      {
        className: 'tag',
        // See the comment in the <style tag about the lookahead pattern
        begin: '<script(?=\\s|>|$)', end: '>',
        keywords: {name: 'script'},
        contains: [TAG_INTERNALS],
        starts: {
          end: '\<\/script\>', returnEnd: true,
          subLanguage: ['actionscript', 'javascript', 'handlebars', 'xml']
        }
      },
      {
        className: 'tag',
        begin: '</?', end: '/?>',
        contains: [
          {
            className: 'name', begin: /[^\/><\s]+/, relevance: 0
          },
          TAG_INTERNALS
        ]
      }
    ]
  };
});

hljs.registerLanguage('markdown', function(hljs) {
  return {
    aliases: ['md', 'mkdown', 'mkd'],
    contains: [
      // highlight headers
      {
        className: 'section',
        variants: [
          { begin: '^#{1,6}', end: '$' },
          { begin: '^.+?\\n[=-]{2,}$' }
        ]
      },
      // inline html
      {
        begin: '<', end: '>',
        subLanguage: 'xml',
        relevance: 0
      },
      // lists (indicators only)
      {
        className: 'bullet',
        begin: '^([*+-]|(\\d+\\.))\\s+'
      },
      // strong segments
      {
        className: 'strong',
        begin: '[*_]{2}.+?[*_]{2}'
      },
      // emphasis segments
      {
        className: 'emphasis',
        variants: [
          { begin: '\\*.+?\\*' },
          { begin: '_.+?_'
          , relevance: 0
          }
        ]
      },
      // blockquotes
      {
        className: 'quote',
        begin: '^>\\s+', end: '$'
      },
      // code snippets
      {
        className: 'code',
        variants: [
          {
            begin: '^```\w*\s*$', end: '^```\s*$'
          },
          {
            begin: '`.+?`'
          },
          {
            begin: '^( {4}|\t)', end: '$',
            relevance: 0
          }
        ]
      },
      // horizontal rules
      {
        begin: '^[-\\*]{3,}', end: '$'
      },
      // using links - title and link
      {
        begin: '\\[.+?\\][\\(\\[].*?[\\)\\]]',
        returnBegin: true,
        contains: [
          {
            className: 'string',
            begin: '\\[', end: '\\]',
            excludeBegin: true,
            returnEnd: true,
            relevance: 0
          },
          {
            className: 'link',
            begin: '\\]\\(', end: '\\)',
            excludeBegin: true, excludeEnd: true
          },
          {
            className: 'symbol',
            begin: '\\]\\[', end: '\\]',
            excludeBegin: true, excludeEnd: true
          }
        ],
        relevance: 10
      },
      {
        begin: /^\[[^\n]+\]:/,
        returnBegin: true,
        contains: [
          {
            className: 'symbol',
            begin: /\[/, end: /\]/,
            excludeBegin: true, excludeEnd: true
          },
          {
            className: 'link',
            begin: /:\s*/, end: /$/,
            excludeBegin: true
          }
        ]
      }
    ]
  };
});

hljs.registerLanguage('python', function(hljs) {
  var KEYWORDS = {
    keyword:
      'and elif is global as in if from raise for except finally print import pass return ' +
      'exec else break not with class assert yield try while continue del or def lambda ' +
      'async await nonlocal|10 None True False',
    built_in:
      'Ellipsis NotImplemented'
  };
  var PROMPT = {
    className: 'meta',  begin: /^(>>>|\.\.\.) /
  };
  var SUBST = {
    className: 'subst',
    begin: /\{/, end: /\}/,
    keywords: KEYWORDS,
    illegal: /#/
  };
  var STRING = {
    className: 'string',
    contains: [hljs.BACKSLASH_ESCAPE],
    variants: [
      {
        begin: /(u|b)?r?'''/, end: /'''/,
        contains: [PROMPT],
        relevance: 10
      },
      {
        begin: /(u|b)?r?"""/, end: /"""/,
        contains: [PROMPT],
        relevance: 10
      },
      {
        begin: /(fr|rf|f)'''/, end: /'''/,
        contains: [PROMPT, SUBST]
      },
      {
        begin: /(fr|rf|f)"""/, end: /"""/,
        contains: [PROMPT, SUBST]
      },
      {
        begin: /(u|r|ur)'/, end: /'/,
        relevance: 10
      },
      {
        begin: /(u|r|ur)"/, end: /"/,
        relevance: 10
      },
      {
        begin: /(b|br)'/, end: /'/
      },
      {
        begin: /(b|br)"/, end: /"/
      },
      {
        begin: /(fr|rf|f)'/, end: /'/,
        contains: [SUBST]
      },
      {
        begin: /(fr|rf|f)"/, end: /"/,
        contains: [SUBST]
      },
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE
    ]
  };
  var NUMBER = {
    className: 'number', relevance: 0,
    variants: [
      {begin: hljs.BINARY_NUMBER_RE + '[lLjJ]?'},
      {begin: '\\b(0o[0-7]+)[lLjJ]?'},
      {begin: hljs.C_NUMBER_RE + '[lLjJ]?'}
    ]
  };
  var PARAMS = {
    className: 'params',
    begin: /\(/, end: /\)/,
    contains: ['self', PROMPT, NUMBER, STRING]
  };
  SUBST.contains = [STRING, NUMBER, PROMPT];
  return {
    aliases: ['py', 'gyp'],
    keywords: KEYWORDS,
    illegal: /(<\/|->|\?)|=>/,
    contains: [
      PROMPT,
      NUMBER,
      STRING,
      hljs.HASH_COMMENT_MODE,
      {
        variants: [
          {className: 'function', beginKeywords: 'def'},
          {className: 'class', beginKeywords: 'class'}
        ],
        end: /:/,
        illegal: /[${=;\n,]/,
        contains: [
          hljs.UNDERSCORE_TITLE_MODE,
          PARAMS,
          {
            begin: /->/, endsWithParent: true,
            keywords: 'None'
          }
        ]
      },
      {
        className: 'meta',
        begin: /^[\t ]*@/, end: /$/
      },
      {
        begin: /\b(print|exec)\(/ // don’t highlight keywords-turned-functions in Python 3
      }
    ]
  };
});

hljs.registerLanguage('ruby', function(hljs) {
  var RUBY_METHOD_RE = '[a-zA-Z_]\\w*[!?=]?|[-+~]\\@|<<|>>|=~|===?|<=>|[<>]=?|\\*\\*|[-/+%^&*~`|]|\\[\\]=?';
  var RUBY_KEYWORDS = {
    keyword:
      'and then defined module in return redo if BEGIN retry end for self when ' +
      'next until do begin unless END rescue else break undef not super class case ' +
      'require yield alias while ensure elsif or include attr_reader attr_writer attr_accessor',
    literal:
      'true false nil'
  };
  var YARDOCTAG = {
    className: 'doctag',
    begin: '@[A-Za-z]+'
  };
  var IRB_OBJECT = {
    begin: '#<', end: '>'
  };
  var COMMENT_MODES = [
    hljs.COMMENT(
      '#',
      '$',
      {
        contains: [YARDOCTAG]
      }
    ),
    hljs.COMMENT(
      '^\\=begin',
      '^\\=end',
      {
        contains: [YARDOCTAG],
        relevance: 10
      }
    ),
    hljs.COMMENT('^__END__', '\\n$')
  ];
  var SUBST = {
    className: 'subst',
    begin: '#\\{', end: '}',
    keywords: RUBY_KEYWORDS
  };
  var STRING = {
    className: 'string',
    contains: [hljs.BACKSLASH_ESCAPE, SUBST],
    variants: [
      {begin: /'/, end: /'/},
      {begin: /"/, end: /"/},
      {begin: /`/, end: /`/},
      {begin: '%[qQwWx]?\\(', end: '\\)'},
      {begin: '%[qQwWx]?\\[', end: '\\]'},
      {begin: '%[qQwWx]?{', end: '}'},
      {begin: '%[qQwWx]?<', end: '>'},
      {begin: '%[qQwWx]?/', end: '/'},
      {begin: '%[qQwWx]?%', end: '%'},
      {begin: '%[qQwWx]?-', end: '-'},
      {begin: '%[qQwWx]?\\|', end: '\\|'},
      {
        // \B in the beginning suppresses recognition of ?-sequences where ?
        // is the last character of a preceding identifier, as in: `func?4`
        begin: /\B\?(\\\d{1,3}|\\x[A-Fa-f0-9]{1,2}|\\u[A-Fa-f0-9]{4}|\\?\S)\b/
      },
      {
        begin: /<<(-?)\w+$/, end: /^\s*\w+$/,
      }
    ]
  };
  var PARAMS = {
    className: 'params',
    begin: '\\(', end: '\\)', endsParent: true,
    keywords: RUBY_KEYWORDS
  };

  var RUBY_DEFAULT_CONTAINS = [
    STRING,
    IRB_OBJECT,
    {
      className: 'class',
      beginKeywords: 'class module', end: '$|;',
      illegal: /=/,
      contains: [
        hljs.inherit(hljs.TITLE_MODE, {begin: '[A-Za-z_]\\w*(::\\w+)*(\\?|\\!)?'}),
        {
          begin: '<\\s*',
          contains: [{
            begin: '(' + hljs.IDENT_RE + '::)?' + hljs.IDENT_RE
          }]
        }
      ].concat(COMMENT_MODES)
    },
    {
      className: 'function',
      beginKeywords: 'def', end: '$|;',
      contains: [
        hljs.inherit(hljs.TITLE_MODE, {begin: RUBY_METHOD_RE}),
        PARAMS
      ].concat(COMMENT_MODES)
    },
    {
      // swallow namespace qualifiers before symbols
      begin: hljs.IDENT_RE + '::'
    },
    {
      className: 'symbol',
      begin: hljs.UNDERSCORE_IDENT_RE + '(\\!|\\?)?:',
      relevance: 0
    },
    {
      className: 'symbol',
      begin: ':(?!\\s)',
      contains: [STRING, {begin: RUBY_METHOD_RE}],
      relevance: 0
    },
    {
      className: 'number',
      begin: '(\\b0[0-7_]+)|(\\b0x[0-9a-fA-F_]+)|(\\b[1-9][0-9_]*(\\.[0-9_]+)?)|[0_]\\b',
      relevance: 0
    },
    {
      begin: '(\\$\\W)|((\\$|\\@\\@?)(\\w+))' // variables
    },
    {
      className: 'params',
      begin: /\|/, end: /\|/,
      keywords: RUBY_KEYWORDS
    },
    { // regexp container
      begin: '(' + hljs.RE_STARTERS_RE + '|unless)\\s*',
      keywords: 'unless',
      contains: [
        IRB_OBJECT,
        {
          className: 'regexp',
          contains: [hljs.BACKSLASH_ESCAPE, SUBST],
          illegal: /\n/,
          variants: [
            {begin: '/', end: '/[a-z]*'},
            {begin: '%r{', end: '}[a-z]*'},
            {begin: '%r\\(', end: '\\)[a-z]*'},
            {begin: '%r!', end: '![a-z]*'},
            {begin: '%r\\[', end: '\\][a-z]*'}
          ]
        }
      ].concat(COMMENT_MODES),
      relevance: 0
    }
  ].concat(COMMENT_MODES);

  SUBST.contains = RUBY_DEFAULT_CONTAINS;
  PARAMS.contains = RUBY_DEFAULT_CONTAINS;

  var SIMPLE_PROMPT = "[>?]>";
  var DEFAULT_PROMPT = "[\\w#]+\\(\\w+\\):\\d+:\\d+>";
  var RVM_PROMPT = "(\\w+-)?\\d+\\.\\d+\\.\\d(p\\d+)?[^>]+>";

  var IRB_DEFAULT = [
    {
      begin: /^\s*=>/,
      starts: {
        end: '$', contains: RUBY_DEFAULT_CONTAINS
      }
    },
    {
      className: 'meta',
      begin: '^('+SIMPLE_PROMPT+"|"+DEFAULT_PROMPT+'|'+RVM_PROMPT+')',
      starts: {
        end: '$', contains: RUBY_DEFAULT_CONTAINS
      }
    }
  ];

  return {
    aliases: ['rb', 'gemspec', 'podspec', 'thor', 'irb'],
    keywords: RUBY_KEYWORDS,
    illegal: /\/\*/,
    contains: COMMENT_MODES.concat(IRB_DEFAULT).concat(RUBY_DEFAULT_CONTAINS)
  };
});

hljs.registerLanguage('yaml', function(hljs) {
  var LITERALS = 'true false yes no null';

  var keyPrefix = '^[ \\-]*';
  var keyName =  '[a-zA-Z_][\\w\\-]*';
  var KEY = {
    className: 'attr',
    variants: [
      { begin: keyPrefix + keyName + ":"},
      { begin: keyPrefix + '"' + keyName + '"' + ":"},
      { begin: keyPrefix + "'" + keyName + "'" + ":"}
    ]
  };

  var TEMPLATE_VARIABLES = {
    className: 'template-variable',
    variants: [
      { begin: '\{\{', end: '\}\}' }, // jinja templates Ansible
      { begin: '%\{', end: '\}' } // Ruby i18n
    ]
  };
  var STRING = {
    className: 'string',
    relevance: 0,
    variants: [
      {begin: /'/, end: /'/},
      {begin: /"/, end: /"/},
      {begin: /\S+/}
    ],
    contains: [
      hljs.BACKSLASH_ESCAPE,
      TEMPLATE_VARIABLES
    ]
  };

  return {
    case_insensitive: true,
    aliases: ['yml', 'YAML', 'yaml'],
    contains: [
      KEY,
      {
        className: 'meta',
        begin: '^---\s*$',
        relevance: 10
      },
      { // multi line string
        className: 'string',
        begin: '[\\|>] *$',
        returnEnd: true,
        contains: STRING.contains,
        // very simple termination: next hash key
        end: KEY.variants[0].begin
      },
      { // Ruby/Rails erb
        begin: '<%[%=-]?', end: '[%-]?%>',
        subLanguage: 'ruby',
        excludeBegin: true,
        excludeEnd: true,
        relevance: 0
      },
      { // data type
        className: 'type',
        begin: '!!' + hljs.UNDERSCORE_IDENT_RE,
      },
      { // fragment id &ref
        className: 'meta',
        begin: '&' + hljs.UNDERSCORE_IDENT_RE + '$',
      },
      { // fragment reference *ref
        className: 'meta',
        begin: '\\*' + hljs.UNDERSCORE_IDENT_RE + '$'
      },
      { // array listing
        className: 'bullet',
        begin: '^ *-',
        relevance: 0
      },
      hljs.HASH_COMMENT_MODE,
      {
        beginKeywords: LITERALS,
        keywords: {literal: LITERALS}
      },
      hljs.C_NUMBER_MODE,
      STRING
    ]
  };
});

  return hljs;
}));
