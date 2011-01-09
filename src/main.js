var bg = module("main", function( bg, require ) {
	
var utils = require("utils"),
	io = require("io"),
	options = require("options"),
	storage_async = require("storage/async"),
	dictionary_async = require("dictionary/async"),
	morfology = require("morfology"),
	Emitter = require("events").Emitter,
	reLocalize = /__MSG_(.+?)__/g;

bg.options = options;
bg.require = require;

function replLocalize( str, name ) {
	return chrome.i18n.getMessage( name ) || str;
}


bg.localizeDom = function( top ) {
	var elements = top.getElementsByTagName("*"),
		element, childs, node, text0, text1;
	
	for ( var i = 0; element = elements[i]; ++i ) {
		childs = element.childNodes;
		
		for ( var j = 0; node = childs[j]; ++j ) {
			if ( node.nodeType === 3 ) {
				text0 = node.nodeValue;
				text1 = text0.replace( reLocalize, replLocalize );
				
				if ( text0 !== text1 ) {
					node.nodeValue = text1;
				}
			}
		}
	}
}

bg.getDictNames = function() {
	return _builtinDicts.map(function( info ) {
		return info.name;
	});
};

function localizedDictName( name ) {
	return chrome.i18n.getMessage( name.replace(/-/g, '_') ) || name;
}
bg.localizedDictionaryName = localizedDictName;

var _dicts = [],
	_dictInfo,
	_options = {},
	
	_builtinDicts = [
		{
			name: 'en-hr',
			revision: 2,
			morf: 'en',
			path: './EH/EH-utf8.Txt',
			sep: '\t',
			term_column: 1,
			def_column: 2
		},
		{
			name: 'hr-en',
			revision: 2,
			morf: 'hr',
			path: './EH/EH-utf8.Txt',
			sep: '\t',
			term_column: 2,
			def_column: 1
		}
	],

	manifest = JSON.parse( io.readFile('./manifest.json') );
	

options.onSaved.addListiner(function( newOptions ) {
	if ( newOptions["tooltip.enabled"] !== _options["tooltip.enabled"] ) {
		setButton( newOptions["tooltip.enabled"] );
	}
	
	_options = newOptions;
	sendToAllTabs({ type: "options", options: newOptions });
});

options.init({
	"tooltip.enabled": true,
	"tooltip.onStay": 2,
	"tooltip.onStay.delays": [200, 500],
	"tooltip.preferedPosition": "above",
	"tooltip.limit": 4,
	"tooltip.onSelect": 2,
	"popup.limit": 0,
	"implicit_dicts": ["en-hr"]
});


function init() {
	var toBuild = [], info, dict, name,
		a, b;
	
	a = mapArrayWithProp( _builtinDicts, 'name' );
	b = mapArrayWithProp( utils.loadObject('dicts') || [], 'name' );
	
	for ( name in a ) {
		if ( !(name in b) || a[name].revision > (b[name].revision || 0)  ) {
			b[ name ] = a[ name ];
		}
	}
	
	for ( name in b ) {
		info = b[name];
		
		morf = info.morf ?
			morfology.Transformations.fromFile( './morf/' + info.morf + '.aff' ) :
			null;
			
		dict = new dictionary_async.Dictionary( info.name, morf );
		
		_dicts.push( dict );
		
		if ( !info.ready ) {
			toBuild.push( dict );
		}
	}
	
	_dictInfo = utils.values( b );
	
	utils.saveObject('dicts', _dictInfo);

	if ( toBuild ) {
		window.setTimeout(function() {
			reloadDicts( toBuild, function() {
				utils.saveObject('dicts', _dictInfo);
			});
		}, 1);
	}
	
	
	console.log( manifest.name + ' ' + manifest.version );
	
	bg.version = manifest.version;
	
	var prev_version = localStorage.version;
	localStorage.version = manifest.version;
	
	if ( !prev_version || prev_version < manifest.version ) {
		openOptionsPage();
	}
}

	
function _findByName_( name ) {
	for ( var i = 0, l = this.length; i < l; ++i ) {
		if ( this[i].name === name ) {
			return this[i];
		}
	}
	return null;
}

function mapArrayWithProp( arr, prop ) {
	var map = utils.HASH();
	for ( var i = 0, l = arr.length; i < l; ++i ) {
		map[ arr[i][prop] ] = arr[i];
	}
	return map;
}

function openOptionsPage() {
	var url = chrome.extension.getURL( manifest.options_page );
	chrome.tabs.create( { url: url } );
}
	

function reportError( error ) {
	console.error( error );
}

function getAllTabs( callback ) {
	chrome.windows.getAll({populate: true}, function( windows ) {
		var tabs = [];
		
		for ( var i = 0, l = windows.length; i < l; ++i ) {
			tabs.push.apply( tabs, windows[i].tabs );
		}
		
		callback( tabs );
	});
}

function sendToAllTabs( request ) {
	getAllTabs(function( tabs ) {
		for ( var i = 0, l = tabs.length; i < l; ++i ) {
			chrome.tabs.sendRequest( tabs[i].id, request );
		}
	});
}

function setButton( enabled ) {
	chrome.browserAction.setIcon({
		path: ( enabled ? "images/icon19.png" : "images/icon19-off.png" )
	});
	var msgName = enabled ? "disableTooltip_title" : "enableTooltip_title";
	chrome.browserAction.setTitle({
		title: chrome.i18n.getMessage( msgName, [ manifest.name ] )
	});
}


chrome.browserAction.onClicked.addListener(function() {
	var o = options.load();
	o["tooltip.enabled"] = !o["tooltip.enabled"];
	options.save( o );
});


chrome.extension.onRequest.addListener(function( req, sender, send ) {
	switch ( req.type ) {
		case "getOptions":
			send( _options );
			break;
		
		case "lookup":
			lookup( req, send );
			break;
		
		default:
			send();
	}
});


function reloadDicts( dicts, callback ) {
	var dict, info;
	
	dicts = dicts.concat();
	
	function next( error ) {
		if ( error ) {
			console.error( error );
			utils.removeFromArray( _dicts, dict );
			utils.removeFromArray( _dictInfo, info );
			dict.free();
			
		} else if ( info ) {
			info.ready = true;
		}
	
		dict = dicts.shift();
		if ( !dict ) {
			callback && callback();
			return;
		}
		
		console.log('Reloadin dictionary "' + dict.name + '".')
		
		info = _findByName_.call( _dictInfo, dict.name );
		
		try {
			var data = io.readFile( info.path );
			var obj = parse(
				data,
				info.sep,
				info.term_column - 1,
				info.def_column - 1
			);
			
		} catch ( error ) {
			next( error );
			return;
		}
		
		dict.empty(next, function() {
			dict.setFromObject( obj, next, next );
		});
	}
	
	next();
}


function parse( data, sep, keyIndex, valueIndex ) {
	var lines = utils.splitLines( data ),
		map = utils.HASH(), parts, key, value;
	
	for ( var i = 0, l = lines.length; i < l; ++i ) {
		parts = lines[i].split( sep );
		
		key = ( parts[ keyIndex ] || "" ).trim().toLowerCase();
		value = ( parts[ valueIndex ] || "" ).trim();
		
		if ( key && value ) {
			if ( key in map ) {
				map[ key ].push( value );
				
			} else {
				map[ key ] = [ value ];
			}
		}
	}
	
	return map;
}


function lookup( o, callback ) {
	var	dicts = o.dicts || _dicts,
		terms = normalizedTerms( typeof o.term === "string" ? [o.term] : o.term ),
		results = [];
	
	dicts = ( typeof dicts[0] === "string" ) ?
		dicts.map( _findByName_, _dicts ) :
		dicts.concat();
	
	function error( error ) {
		reportError( error );
		collect();
	}
	
	function collect( res ) {
		if ( res ) {
			res = exactsFirst( res );
			
			if ( o.limit && res.length > o.limit ) {
				res.length = o.limit;
			}
			
			if ( res.length ) {
				results.push.apply( results, res );
			}
		}
		
		if ( dicts.length ) {
			dicts.shift().lookup( terms, o.stopOnExact, error, collect );
			
		} else {
			if ( o.localize ) {
				results.forEach(function( res ) {
					res.dict_localized = localizedDictName( res.dict );
				});
			}
			callback( results );
		}
	}
	
	collect();
}


function K( obj ) {
	return !!obj;
}

function exactsFirst( res ) {
	var exacts = [], others = [], r;
	
	for ( var i = 0, l = res.length; i < l; ++i ) {
		r = res[i];
		
		if ( r.originalTerm && r.originalTerm !== r.term ) {
			others.push( r );
			
		} else {
			exacts.push( r );
		}
	}
	
	return exacts.concat( others );
}

function normalizedTerms( terms ) {
	var t, rv = [];
	
	for ( var i = 0, l = terms.length; i < l; ++i ) {
		t = terms[i].replace(/[\s—\-_]+/g, ' ').trim().toLowerCase();
		
		if ( t.indexOf(' ') !== -1 ) {
			rv.push( t.replace(/ /g, '-'), t, t.replace(/ /g, '') );
			
		} else {
			rv.push( t );
		}
	}
	
	return rv;
}


init();
//setTimeout( init, 5000 );


});
