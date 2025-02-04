/* global axe */

// Let the user know they need to disable their axe/attest extension before running the tests.
if (window.__AXE_EXTENSION__) {
	throw new Error(
		'You must disable your axe/attest browser extension in order to run the test suite.'
	);
}

/*eslint indent: 0*/
var testUtils = {};

/**
 * Create a check context for mocking/resetting data and relatedNodes in tests
 *
 * @return Object
 */
testUtils.MockCheckContext = function() {
	'use strict';
	return {
		_relatedNodes: [],
		_data: null,
		// When using this.async() in a check, assign a function to _onAsync
		// to catch the response.
		_onAsync: null,
		async: function() {
			var self = this;
			return function(result) {
				// throws if _onAsync isn't set
				self._onAsync(result, self);
			};
		},
		data: function(d) {
			this._data = d;
		},
		relatedNodes: function(nodes) {
			this._relatedNodes = Array.isArray(nodes) ? nodes : [nodes];
		},
		reset: function() {
			this._data = null;
			this._relatedNodes = [];
			this._onAsync = null;
		}
	};
};

/**
 * Provide an API for determining Shadow DOM v0 and v1 support in tests.
 * PhantomJS doesn't have Shadow DOM support, while some browsers do.
 *
 * @param HTMLDocumentElement		The document of the current context
 * @return Object
 */
testUtils.shadowSupport = (function(document) {
	'use strict';
	var v0 =
			document.body && typeof document.body.createShadowRoot === 'function',
		v1 = document.body && typeof document.body.attachShadow === 'function';

	return {
		v0: v0 === true,
		v1: v1 === true,
		undefined:
			document.body &&
			typeof document.body.attachShadow === 'undefined' &&
			typeof document.body.createShadowRoot === 'undefined'
	};
})(document);

/**
 * Method for injecting content into a fixture and caching
 * the flattened DOM tree (light and Shadow DOM together)
 *
 * @param {String|Node} content Stuff to go into the fixture (html or DOM node)
 * @return HTMLElement
 */
testUtils.fixtureSetup = function(content) {
	'use strict';
	var fixture = document.querySelector('#fixture');
	if (typeof content !== 'undefined') {
		fixture.innerHTML = '';
	}

	if (typeof content === 'string') {
		fixture.innerHTML = content;
	} else if (content instanceof Node) {
		fixture.appendChild(content);
	} else if (Array.isArray(content)) {
		content.forEach(function(node) {
			fixture.appendChild(node);
		});
	}
	axe._tree = axe.utils.getFlattenedTree(fixture);
	axe._selectorData = axe.utils.getSelectorData(axe._tree);

	return fixture;
};

/**
 * Create check arguments
 *
 * @param Node|String 	Stuff to go into the fixture (html or node)
 * @param Object				Options argument for the check (optional, default: {})
 * @param String				Target for the check, CSS selector (default: '#target')
 * @return Array
 */
testUtils.checkSetup = function(content, options, target) {
	'use strict';
	// Normalize the params
	if (typeof options !== 'object') {
		target = options;
		options = {};
	}
	// Normalize target, allow it to be the inserted node or '#target'
	target = target || (content instanceof Node ? content : '#target');
	testUtils.fixtureSetup(content);

	var node;
	if (typeof target === 'string') {
		node = axe.utils.querySelectorAll(axe._tree[0], target)[0];
	} else if (target instanceof Node) {
		node = axe.utils.getNodeFromTree(target);
	} else {
		node = target;
	}
	return [node.actualNode, options, node];
};

/**
 * Create check arguments with Shadow DOM. Target can be inside or outside of Shadow DOM, queried by
 * adding `id="target"` to a fragment. Or specify a custom selector as the `targetSelector` argument.
 *
 * @param Node|String 	Stuff to go into the fixture (html string or DOM Node)
 * @param Node|String 	Stuff to go into the shadow boundary (html or node)
 * @param Object				Options argument for the check (optional, default: {})
 * @param String				Target selector for the check, can be inside or outside of Shadow DOM (optional, default: '#target')
 * @return Array
 */
testUtils.shadowCheckSetup = function(
	content,
	shadowContent,
	options,
	targetSelector
) {
	'use strict';

	// Normalize target, allow it to be the provided string or use '#target' to query composed tree
	if (typeof targetSelector !== 'string') {
		targetSelector = '#target';
	}

	// Normalize the object params
	if (typeof options !== 'object') {
		options = {};
	}

	var fixture = testUtils.fixtureSetup(content);
	var targetCandidate = fixture.querySelector(targetSelector);
	var container = targetCandidate;
	if (!targetCandidate) {
		// check if content specifies a shadow container
		container = fixture.querySelector('#shadow');
		if (!container) {
			container = fixture.firstChild;
		}
	}
	// attach a shadowRoot with the content provided
	var shadowRoot = container.attachShadow({ mode: 'open' });
	if (typeof shadowContent === 'string') {
		shadowRoot.innerHTML = shadowContent;
	} else if (content instanceof Node) {
		shadowRoot.appendChild(shadowContent);
	}

	if (!targetCandidate) {
		targetCandidate = shadowRoot.querySelector(targetSelector);
	}
	if (!targetSelector && !targetCandidate) {
		throw 'shadowCheckSetup requires at least one fragment to have #target, or a provided targetSelector';
	}

	// query the composed tree AFTER shadowDOM has been attached
	axe._tree = axe.utils.getFlattenedTree(fixture);
	var node = axe.utils.getNodeFromTree(targetCandidate);
	return [node.actualNode, options, node];
};

/**
 * Setup axe._tree flat tree
 * @param Node   Stuff to go in the flat tree
 * @returns vNode[]
 */
testUtils.flatTreeSetup = function(content) {
	axe._tree = axe.utils.getFlattenedTree(content);
	return axe._tree;
};

/**
 * Wait for all nested frames to be loaded
 *
 * @param Object				Window to wait for (optional)
 * @param function			Callback, called once resolved
 */
testUtils.awaitNestedLoad = function awaitNestedLoad(win, cb) {
	'use strict';
	if (typeof win === 'function') {
		cb = win;
		win = window;
	}
	var document = win.document;
	var q = axe.utils.queue();

	// Wait for page load
	q.defer(function(resolve) {
		if (document.readyState === 'complete') {
			resolve();
		} else {
			win.addEventListener('load', resolve);
		}
	});

	// Wait for all frames to be loaded
	Array.from(document.querySelectorAll('iframe')).forEach(function(frame) {
		q.defer(function(resolve) {
			return awaitNestedLoad(frame.contentWindow, resolve);
		});
	});

	// Complete (don't pass the args on to the callback)
	q.then(function() {
		cb();
	});
};

/**
 * Add a given stylesheet dynamically to the document
 *
 * @param {Object} data composite object containing properties to create stylesheet
 * @property {String} data.href relative or absolute url for stylesheet to be loaded
 * @property {Boolean} data.mediaPrint boolean to represent if the constructed sheet is for print media
 * @property {String} data.text text contents to be written to the stylesheet
 * @returns {Object} axe.utils.queue
 */
testUtils.addStyleSheet = function addStyleSheet(data) {
	var q = axe.utils.queue();
	if (data.href) {
		q.defer(function(resolve, reject) {
			var link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = data.href;
			if (data.mediaPrint) {
				link.media = 'print';
			}
			link.onload = function() {
				resolve();
			};
			link.onerror = function() {
				reject();
			};
			document.head.appendChild(link);
		});
	} else {
		q.defer(function(resolve) {
			var style = document.createElement('style');
			style.type = 'text/css';
			style.appendChild(document.createTextNode(data.text));
			document.head.appendChild(style);
			resolve();
		});
	}
	return q;
};

/**
 * Add a list of stylesheets
 *
 * @param {Object} sheets array of sheets data object
 * @returns {Object} axe.utils.queue
 */
testUtils.addStyleSheets = function addStyleSheets(sheets) {
	var q = axe.utils.queue();
	sheets.forEach(function(data) {
		q.defer(axe.testUtils.addStyleSheet(data));
	});
	return q;
};

/**
 * Injecting content into a fixture and return queried element within fixture
 *
 * @param {String|Node} content to go into the fixture (html or DOM node)
 * @return HTMLElement
 */
testUtils.queryFixture = function queryFixture(html, query) {
	testUtils.fixtureSetup(html);
	return axe.utils.querySelectorAll(axe._tree, query || '#target')[0];
};

/**
 * Test function for detecting IE11 user agent string
 *
 * @param {Object} navigator The navigator object of the current browser
 * @return {boolean}
 */
testUtils.isIE11 = (function isIE11(navigator) {
	return navigator.userAgent.indexOf('Trident/7') !== -1;
})(navigator);

axe.testUtils = testUtils;

afterEach(function() {
	axe._cache.clear();
});
