( () => {
'use strict';

const
    MODULE_NAME = 'TwitterTimeline',
    
    context_global = ( typeof global != 'undefined' ) ? global : ( typeof window != 'undefined' ) ? window : this; // 注: Firefox WebExtension の content_scripts 内では this !== window

( ( exports ) => {
const
    VERSION = '0.1.0',
    
    DEFAULT_DEBUG_MODE = false,
    DEFAULT_SCRIPT_NAME = MODULE_NAME,
    
    self = undefined,
    // TODO: class 関数内で self を使っているが、window.self が参照できるため、定義し忘れていてもエラーにならず気づきにくい
    // →暫定的に const self を undefined で定義して window.self への参照を切る
    
    use_agent = navigator.userAgent.toLowerCase(),
    IS_FIREFOX = ( 0 <= use_agent.toLowerCase().indexOf( 'firefox' ) ),
    
    // ■ Firefox で XMLHttpRequest や fetch が予期しない動作をしたり、開発者ツールのネットワークに通信内容が表示されないことへの対策
    // 参考: [Firefox のアドオン(content_scripts)でXMLHttpRequestやfetchを使う場合の注意 - 風柳メモ](https://memo.furyutei.work/entry/20180718/1531914142)
    XMLHttpRequest = ( typeof content != 'undefined' && typeof content.XMLHttpRequest == 'function' ) ? content.XMLHttpRequest  : context_global.XMLHttpRequest,
    fetch = ( typeof content != 'undefined' && typeof content.fetch == 'function' ) ? content.fetch  : context_global.fetch,
    
    format_date = ( date, format, is_utc ) => {
        if ( ! format ) {
            format = 'YYYY-MM-DD hh:mm:ss.SSS';
        }
        
        let msec = ( '00' + ( ( is_utc ) ? date.getUTCMilliseconds() : date.getMilliseconds() ) ).slice( -3 ),
            msec_index = 0;
        
        if ( is_utc ) {
            format = format
                .replace( /YYYY/g, date.getUTCFullYear() )
                .replace( /MM/g, ( '0' + ( 1 + date.getUTCMonth() ) ).slice( -2 ) )
                .replace( /DD/g, ( '0' + date.getUTCDate() ).slice( -2 ) )
                .replace( /hh/g, ( '0' + date.getUTCHours() ).slice( -2 ) )
                .replace( /mm/g, ( '0' + date.getUTCMinutes() ).slice( -2 ) )
                .replace( /ss/g, ( '0' + date.getUTCSeconds() ).slice( -2 ) )
                .replace( /S/g, ( all ) => {
                    return msec.charAt( msec_index ++ );
                } );
        }
        else {
            format = format
                .replace( /YYYY/g, date.getFullYear() )
                .replace( /MM/g, ( '0' + ( 1 + date.getMonth() ) ).slice( -2 ) )
                .replace( /DD/g, ( '0' + date.getDate() ).slice( -2 ) )
                .replace( /hh/g, ( '0' + date.getHours() ).slice( -2 ) )
                .replace( /mm/g, ( '0' + date.getMinutes() ).slice( -2 ) )
                .replace( /ss/g, ( '0' + date.getSeconds() ).slice( -2 ) )
                .replace( /S/g, ( all ) => {
                    return msec.charAt( msec_index ++ );
                } );
        }
        
        return format;
    }, // end of format_date()
    
    get_gmt_datetime = ( time, is_msec ) => {
        let date = new Date( ( is_msec ) ? time : 1000 * time );
        
        return format_date( date, 'YYYY-MM-DD_hh:mm:ss_GMT', true );
    }, // end of get_gmt_datetime()
    
    get_log_timestamp = () => format_date( new Date() ),
    
    log_debug = ( ... args ) => {
        if ( ! exports.debug_mode ) {
            return;
        }
        console.debug( '%c' + '[' + exports.logged_script_name + '] ' + get_log_timestamp(), 'color: gray;', ... args );
    },
    
    log = ( ... args ) => {
        console.log( '%c' + '[' + exports.logged_script_name + '] ' +  + get_log_timestamp(), 'color: teal;', ... args );
    },
    
    log_info = ( ... args ) => {
        console.info( '%c' +  '[' + exports.logged_script_name + '] ' + get_log_timestamp(), 'color: darkslateblue;', ... args );
    },
    
    log_error = ( ... args ) => {
        console.error( '%c' + '[' + exports.logged_script_name + '] ' + get_log_timestamp(), 'color: purple;', ... args );
    },
    
    exit_for_unsupported = ( message = 'This library does not work in current environment.' ) => {
        log_error( exit_for_unsupported );
        throw new Error( message );
    },
    
    chrome = ( () => {
        const
            chrome = ( this.browser && this.browser.runtime ) ? this.browser : this.chrome; // 注: Firefox の content_scripts 内では this !== window
        
        if ( ( ! chrome ) || ( ! chrome.runtime ) ) {
            exit_for_unsupported();
        }
        
        return chrome;
    } )(),
    
    Decimal = ( () => {
        if ( context_global.Decimal ) {
            // [MikeMcl/decimal.js: An arbitrary-precision Decimal type for JavaScript](https://github.com/MikeMcl/decimal.js)
            return context_global.Decimal;
        }
        
        if ( typeof BigInt == 'undefined' ) {
            exit_for_unsupported();
        }
        
        const
            Decimal = class {
                constructor( number ) {
                    this.bignum = this.floor( number );
                }
                
                add( n ) {
                    return new Decimal( this.bignum + this.floor( n ) );
                }
                
                sub( n ) {
                    return new Decimal( this.bignum - this.floor( n ) );
                }
                
                mul( n ) {
                    return new Decimal( this.bignum * this.floor( n ) );
                }
                
                div( n ) {
                    return new Decimal( this.bignum / this.floor( n ) );
                }
                
                mod( n ) {
                    return new Decimal( this.bignum % this.floor( n ) );
                }
                
                pow( n ) {
                    return new Decimal( this.bignum ** this.floor( n ) );
                }
                
                floor( n ) {
                    try {
                        return BigInt( n );
                    }
                    catch ( error ) {
                        return BigInt( Math.floor( n ) ); // TODO: 小数部があると精度が落ちる
                    }
                }
                
                toString() {
                    return this.bignum.toString();
                }
            };
        
        Object.assign( Decimal, {
            add : ( n, e ) => {
                return new Decimal( n ).add( e );
            },
            
            sub : ( n, e ) => {
                return new Decimal( n ).sub( e );
            },
            
            mul : ( n, e ) => {
                return new Decimal( n ).mul( e );
            },
            
            div : ( n, e ) => {
                return new Decimal( n ).div( e );
            },
            
            mod : ( n, e ) => {
                return new Decimal( n ).mod( e );
            },
            
            pow : ( n, e ) => {
                return new Decimal( n ).pow( e );
            },
        } );
        
        return Decimal;
    } )(),
    
    ID_INC_PER_MSEC = Decimal.pow( 2, 22 ), // ミリ秒毎のID増分
    ID_INC_PER_SEC = ID_INC_PER_MSEC.mul( 1000 ), // 秒毎のID増分
    TWEPOCH_OFFSET_MSEC = 1288834974657,
    TWEPOCH_OFFSET_SEC = Math.ceil( TWEPOCH_OFFSET_MSEC / 1000 ), // 1288834974.657 sec (2011.11.04 01:42:54(UTC)) (via http://www.slideshare.net/pfi/id-15755280)
    DEFAULT_UNTIL_ID = '9153891586667446272', // // datetime_to_tweet_id(Date.parse( '2080-01-01T00:00:00.000Z' )) => 9153891586667446272
    
    TIMELINE_TYPE = {
        unknown : null,
        user : 'user',
        search : 'search',
        likes : 'likes',
        notifications : 'notifications',
        bookmarks : 'bookmarks',
    },
    
    API_TYPE_IN_USE = {
        same_as_timeline_type : null,
        search : TIMELINE_TYPE.search,
    },
    
    TIMELINE_STATUS = {
        unknown : null,
        init : 'init',
        search : 'search',
        end : 'end',
        error : 'error',
    },
    
    REACTION_TYPE = {
        unknown : null,
        none : 'none',
        retweet : 'retweet',
        like : 'like',
        bookmark : 'bookmark',
        //notice : 'notice',
        mention : 'mention',
        reply : 'reply',
        message : 'message',
        other_notice : 'other_notice',
    },
    
    MEDIA_TYPE = {
        unknown : null,
        nomedia : 'nomedia',
        image : 'image',
        gif : 'gif',
        video : 'video',
    },
    
    get_tweet_id_from_utc_sec = ( utc_sec ) => {
        if ( ( ! utc_sec ) || ( utc_sec < TWEPOCH_OFFSET_SEC ) ) {
            return null;
        }
        
        return new Decimal( utc_sec * 1000 ).sub( TWEPOCH_OFFSET_MSEC ).mul( ID_INC_PER_MSEC ).toString();
    }, // end of get_tweet_id_from_utc_sec()
    
    TWITTER_API = new class {
        constructor() {
            const
                self = this,
                current_time_msec = Date.now();
            
            Object.assign( self, {
                API_AUTHORIZATION_BEARER : 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
                // TODO: 継続して使えるかどうか不明→変更された場合の対応を要検討
                // ※ https://abs.twimg.com/responsive-web/client-web/main.<version>.js (例：https://abs.twimg.com/responsive-web/client-web/main.1b19a825.js) 内で定義されている値
                // ※ これを使用しても、一定時間内のリクエスト回数に制限有り→参考: [TwitterのAPI制限 [2019/11/17現在] - Qiita](https://qiita.com/mpyw/items/32d44a063389236c0a65)
                
                // Twitter API には Rate Limit があるため、続けてコールする際に待ち時間を挟む必要あり（15分毎にリセットされる）
                // - statuses/user_timeline 等の場合、15分で900回
                // - activity/about_me 等の場合、15分で180回
                TWITTER_API_DELAY_SHORT : 1100,
                TWITTER_API_DELAY_LONG : 5100,
                // TODO: 別のタブで並列して実行されている場合や、別ブラウザでの実行は考慮していない
            } );
            
            Object.assign( self, {
                API_DEFINITIONS : {
                    [ TIMELINE_TYPE.user ] : {
                        url_template : 'https://api.twitter.com/1.1/statuses/user_timeline.json?count=#COUNT#&include_my_retweet=1&include_rts=1&cards_platform=Web-13&include_entities=1&include_user_entities=1&include_cards=1&send_error_codes=1&tweet_mode=extended&include_ext_alt_text=true&include_reply_count=true',
                        tweet_number : { default : 20, limit : 40 },
                        min_delay_ms : self.TWITTER_API_DELAY_SHORT,
                        max_retry : 3,
                    },
                    
                    [ TIMELINE_TYPE.search ] : {
                        url_template : 'https://api.twitter.com/1.1/search/universal.json?q=#QUERY#&count=#COUNT#&modules=status&result_type=recent&pc=false&cards_platform=Web-13&include_entities=1&include_user_entities=1&include_cards=1&send_error_codes=1&tweet_mode=extended&include_ext_alt_text=true&include_reply_count=true',
                        tweet_number : { default : 20, limit : 40 },
                        min_delay_ms : self.TWITTER_API_DELAY_SHORT,
                        max_retry : 3,
                    },
                    
                    [ TIMELINE_TYPE.notifications ] : {
                        url_template : 'https://api.twitter.com/1.1/activity/about_me.json?model_version=7&count=#COUNT#&skip_aggregation=true&cards_platform=Web-13&include_entities=1&include_user_entities=1&include_cards=1&send_error_codes=1&tweet_mode=extended&include_ext_alt_text=true&include_reply_count=true',
                        tweet_number : { default : 20, limit : 40 },
                        min_delay_ms : self.TWITTER_API_DELAY_LONG,
                        max_retry : 3,
                    },
                }
            } );
            
            Object.assign( self, {
                language : '',
                api_called_infos : {
                    [ TIMELINE_TYPE.user ] : { count : 0, last_time_msec : current_time_msec, last_error : null },
                    [ TIMELINE_TYPE.search ] : { count : 0, last_time_msec : current_time_msec, last_error : null },
                    [ TIMELINE_TYPE.notifications ] : { count : 0, last_time_msec : current_time_msec, last_error : null },
                },
            } );
            
            return self;
        } // end of constructor()
        
        get client_language() {
            const
                self = this;
            
            if ( ! self.language ) {
                if ( new URL( location.href ).hostname == 'tweetdeck.twitter.com' ) {
                    self.language = ( navigator.browserLanguage || navigator.language || navigator.userLanguage ).substr( 0, 2 );
                }
                else {
                    try {
                        self.language = document.querySelector( 'html' ).getAttribute( 'lang' );
                    }
                    catch ( error ) {
                    }
                }
            }
            
            return self.language;
        } // end of get client_language()
        
        get csrf_token() {
            let csrf_token;
            
            try {
                csrf_token = document.cookie.match( /ct0=(.*?)(?:;|$)/ )[ 1 ];
            }
            catch ( error ) {
                csrf_token = null;
            }
            
            return csrf_token;
        } // end of get csrf_token()
        
        create_api_header() {
            const
                self = this;
            
            return {
                'authorization' : 'Bearer ' + self.API_AUTHORIZATION_BEARER,
                'x-csrf-token' : self.csrf_token,
                'x-twitter-active-user' : 'yes',
                'x-twitter-auth-type' : 'OAuth2Session',
                'x-twitter-client-language' : self.client_language,
            };
        } // end of create_api_header()
        
        async wait( wait_msec ) {
            if ( wait_msec <= 0 ) {
                wait_msec = 1;
            }
            
            await new Promise( ( resolve, reject ) => {
                setTimeout( () => {
                    resolve();
                }, wait_msec );
            } ).catch( error => null );
        } // end of wait()
        
        async fetch_json( url, options ) {
            log_debug( 'fetch_json()', url, options );
            
            /*
            //let result = await fetch( url, options ).then( ( response ) => { json : response.json() } ).catch( error => { error : error } );
            //
            // Chrome において戻り値が null になる→レスポンスボディが空のため、response.json() でエラーが発生
            // > Cross-Origin Read Blocking (CORB) blocked cross-origin response <url> with MIME type application/json. See https://www.chromestatus.com/feature/5629709824032768 for more details.
            // 参考：
            //   [Changes to Cross-Origin Requests in Chrome Extension Content Scripts - The Chromium Projects](https://www.chromium.org/Home/chromium-security/extension-content-script-fetches)
            //   [Cross-Origin Read Blocking (CORB) とは - ASnoKaze blog](https://asnokaze.hatenablog.com/entry/2018/04/10/205717)
            */
            let result = await new Promise( ( resolve, reject ) => {
                    chrome.runtime.sendMessage( {
                        type : 'FETCH_JSON',
                        url : url,
                        options : options,
                    }, ( response ) => {
                        log_debug( 'FETCH_JSON => response', response );
                        resolve( response );
                        // TODO: シークレット(incognito)モードだと、{"errors":[{"code":353,"message":"This request requires a matching csrf cookie and header."}]} のように返されてしまう
                        // → manifest.json に『"incognito" : "split"』が必要
                    } );
                } );
            
            if ( result.error ) {
                log_error( 'Error in fetch_json()', url, options, result.error );
            }
            
            return result;
        } // end of fetch_json()
        
        async fetch_timeline_common( timeline_type, url, options ) {
            const
                self = this,
                api_def = self.API_DEFINITIONS[ timeline_type ],
                api_called_info = self.api_called_infos[ timeline_type ];
            
            let wait_msec = api_called_info.last_time_msec + ( api_def.min_delay_ms || self.TWITTER_API_DELAY_LONG ) - Date.now(),
                retry_number = 0,
                result;
            
            log_debug( 'fetch_timeline_common(): ', timeline_type, url, options );
            log_debug( 'wait_msec:', wait_msec, '(before) api_def:', api_def, 'api_called_info:', api_called_info );
            
            options = Object.assign( {
                method : 'GET',
                headers : self.create_api_header(),
                mode: 'cors',
                credentials: 'include',
            }, options || {} );
            
            do {
                await self.wait( ( retry_number <= 0 ) ? wait_msec : ( self.TWITTER_API_DELAY_LONG * retry_number ) );
                
                api_called_info.count ++;
                api_called_info.last_time_msec = Date.now();
                
                log_debug( 'retry_number:', retry_number, 'api_def:', api_def, 'api_called_info:', api_called_info );
                
                api_called_info.last_error = null;
                
                result = await self.fetch_json( url, options );
                
                api_called_info.last_error = result.error;
                
                if ( ( ! result.error ) && result.json ) {
                    break;
                }
                
                retry_number ++;
            } while ( api_def.max_retry && ( retry_number <= api_def.max_retry ) );
            
            log_debug( 'fetched result:', result );
            
            return result.json;
        } // end of fetch_timeline_common()
        
        async fetch_user_timeline( user_id, screen_name, max_id, count ) {
            const
                self = this,
                timeline_type = TIMELINE_TYPE.user,
                api_def = self.API_DEFINITIONS[ timeline_type ];
            
            if ( isNaN( count ) || ( count < 0 ) || ( api_def.tweet_number.limit < count ) ) {
                count = api_def.tweet_number.default;
            }
            
            let api_url = ( api_def.url_template + ( ( user_id ) ? '&user_id=' + encodeURIComponent( user_id ) : '&screen_name=' + encodeURIComponent( screen_name ) ) )
                    .replace( /#COUNT#/g, count ) + ( /^\d+$/.test( max_id || '' ) ? '&max_id=' + max_id : '' );
            
            return await self.fetch_timeline_common( timeline_type, api_url );
        } // end of fetch_user_timeline()
        
        async fetch_search_timeline( query, count ) {
            const
                self = this,
                timeline_type = TIMELINE_TYPE.search,
                api_def = self.API_DEFINITIONS[ timeline_type ];
            
            if ( isNaN( count ) || ( count < 0 ) || ( api_def.tweet_number.limit < count ) ) {
                count = api_def.tweet_number.default;
            }
            
            let api_url = api_def.url_template.replace( /#QUERY#/g, encodeURIComponent( query ) ).replace( /#COUNT#/g, count );
            
            return await self.fetch_timeline_common( timeline_type, api_url );
        } // end of fetch_search_timeline()
        
        async fetch_notifications_timeline( max_id, count ) {
            const
                self = this,
                timeline_type = TIMELINE_TYPE.notifications,
                api_def = self.API_DEFINITIONS[ timeline_type ];
            
            if ( isNaN( count ) || ( count < 0 ) || ( api_def.tweet_number.limit < count ) ) {
                count = api_def.tweet_number.default;
            }
            
            let api_url = api_def.url_template.replace( /#COUNT#/g, count ) + ( /^\d+$/.test( max_id || '' ) ? '&max_id=' + max_id : '' );
            
            return await self.fetch_timeline_common( timeline_type, api_url );
        } // end of fetch_notifications_timeline()
    }, // end of TWITTER_API
    
    TIMELINE_TOOLBOX = new class {
        constructor() {
            const
                self = this;
            
            return self;
        } // end of constructor()
        
        async get_user_timeline_info( options ) {
            const
                self = this;
            
            log_debug( 'get_user_timeline_info() called', options );
            
            if ( ! options ) {
                options = {};
            }
            
            let user_id = options.user_id,
                screen_name = options.screen_name,
                max_id = options.max_id,
                count = options.count,
                json = await TWITTER_API.fetch_user_timeline( user_id, screen_name, max_id, count ).catch( ( error ) => {
                    log_error( 'TWITTER_API.fetch_user_timeline() error:', error );
                    return null;
                } );
            
            if ( ! json ) {
                return {
                    json : null,
                    error : 'fetch error',
                };
            }
            
            log_debug( 'get_user_timeline_info(): json=', json, Array.isArray( json ) );
            
            let tweets = json;
            
            if ( ! Array.isArray( tweets ) ) {
                return {
                    json : json,
                    error : 'result JSON structure error',
                };
            }
            
            let tweet_info_list = tweets.map( tweet => self.get_tweet_info_from_tweet_status( tweet ) );
            
            log_debug( 'get_user_timeline_info(): tweet_info_list:', tweet_info_list );
            
            return {
                json : json,
                timeline_info : {
                    tweet_info_list : tweet_info_list,
                }
            };
        } // end of get_user_timeline_info()
        
        async get_search_timeline_info( query, options ) {
            const
                self = this;
            
            log_debug( 'get_search_timeline_info() called', query, options );
            
            if ( ! options ) {
                options = {};
            }
            
            let count = options.count,
                json = await TWITTER_API.fetch_search_timeline( query, count ).catch( ( error ) => {
                    log_error( 'TWITTER_API.fetch_user_timeline() error:', error );
                    return null;
                } );
            
            if ( ! json ) {
                return {
                    json : null,
                    error : 'fetch error',
                };
            }
            
            log_debug( 'get_search_timeline_info(): json=', json );
            
            let modules = json.modules;
            
            if ( ! Array.isArray( modules ) ) {
                return {
                    json : json,
                    error : 'result JSON structure error',
                };
            }
            
            let tweet_info_list = modules.map( ( module ) => {
                    let tweet;
                    
                    try {
                        tweet = module.status.data;
                        tweet.metadata = module.status.metadata;
                    }
                    catch ( error ) {
                        return null;
                    }
                    
                    return self.get_tweet_info_from_tweet_status( tweet );
                } ).filter( tweet_info => tweet_info );
            
            return  {
                json : json,
                timeline_info : {
                    tweet_info_list : tweet_info_list,
                }
            };
        } // end of get_search_timeline_info()
        
        get_tweet_info_from_tweet_status( tweet_status ) {
            const
                get_media_list = ( tweet_status ) => {
                    let source_media_infos = [];
                    
                    if ( tweet_status.extended_entities && tweet_status.extended_entities.media ) {
                        source_media_infos = tweet_status.extended_entities.media;
                    }
                    else if ( tweet_status.entities && tweet_status.entities.media ) {
                        source_media_infos = tweet_status.entities.media;
                    }
                    
                    return source_media_infos.map( ( source_media_info ) => {
                        let media_type = MEDIA_TYPE.unknown,
                            media_url = null,
                            get_max_bitrate_video_info = ( video_infos ) => {
                                return video_infos.filter( video_info => video_info.content_type == 'video/mp4' ).reduce( ( video_info_max_bitrate, video_info ) => {
                                    return ( video_info_max_bitrate.bitrate < video_info.bitrate ) ? video_info : video_info_max_bitrate;
                                }, { bitrate : -1 } );
                            };
                        
                        switch ( source_media_info.type ) {
                            case 'photo' :
                                media_type = MEDIA_TYPE.image;
                                try {
                                    media_url = source_media_info.media_url_https.replace( /\.([^.]+)$/, '?format=$1&name=orig' );
                                }
                                catch ( error ) {
                                }
                                break;
                            
                            case 'animated_gif' :
                                media_type = MEDIA_TYPE.gif;
                                media_url = get_max_bitrate_video_info( ( source_media_info.video_info || {} ).variants || [] ).url;
                                break;
                            
                            case 'video' :
                                media_type = MEDIA_TYPE.video;
                                media_url = get_max_bitrate_video_info( ( source_media_info.video_info || {} ).variants || [] ).url;
                                break;
                        }
                        
                        return {
                            media_type,
                            media_url,
                        };
                    } ).filter( media => ( media.media_type != MEDIA_TYPE.unknown ) && ( media.media_url ) );
                };
            
            let reacted_info = ( () => {
                    let retweeted_status = tweet_status.retweeted_status || {};
                    
                    if ( ! retweeted_status.id_str ) {
                        return {
                            type : REACTION_TYPE.none,
                        }
                    }
                    
                    let user = retweeted_status.user || {},
                        timestamp_ms = Date.parse( retweeted_status.created_at ),
                        date = new Date( timestamp_ms ),
                        datetime = format_date( date, 'YYYY/MM/DD hh:mm:ss' ),
                        media_list = get_media_list( retweeted_status );
                    
                    return {
                        type : REACTION_TYPE.retweet,
                        id : retweeted_status.id_str,
                        user_id : user.id_str,
                        screen_name : user.screen_name,
                        user_name : user.name,
                        user_icon : user.profile_image_url_https,
                        timestamp_ms,
                        date,
                        datetime,
                        text : retweeted_status.full_text,
                        media_type : ( 0 < media_list.length ) ? media_list[ 0 ].media_type : MEDIA_TYPE.nomedia,
                        media_list,
                        reply_count : retweeted_status.reply_count,
                        retweet_count : retweeted_status.retweet_count,
                        like_count : retweeted_status.favorite_count,
                        tweet_url : 'https://twitter.com/' + user.screen_name + '/status/' + retweeted_status.id_str,
                        
                        twwet_status : retweeted_status, // ※確認用
                    };
                } )(),
                
                user = tweet_status.user,
                timestamp_ms = Date.parse( tweet_status.created_at ),
                date = new Date( timestamp_ms ),
                datetime = format_date( date, 'YYYY/MM/DD hh:mm:ss' ),
                media_list = get_media_list( tweet_status ),
                
                tweet_info = {
                    id : tweet_status.id_str,
                    user_id : user.id_str,
                    screen_name : user.screen_name,
                    user_name : user.name,
                    user_icon : user.profile_image_url_https,
                    timestamp_ms,
                    date,
                    datetime,
                    text : tweet_status.full_text,
                    media_type : ( 0 < media_list.length ) ? media_list[ 0 ].media_type : MEDIA_TYPE.nomedia,
                    media_list,
                    reply_count : tweet_status.reply_count,
                    retweet_count : tweet_status.retweet_count,
                    like_count : tweet_status.favorite_count,
                    tweet_url : 'https://twitter.com/' + user.screen_name + '/status/' + tweet_status.id_str,
                    
                    reacted_info,
                    
                    tweet_status, // ※確認用
                };
            
            log_debug( 'get_tweet_info_from_tweet_status(): tweet_info', tweet_info );
            
            return tweet_info;
        } // get_tweet_info_from_tweet_status();
    
    }, // end of TIMELINE_TOOLBOX()
    
    ClassTimelineTemplate = class {
        constructor( parameters ) {
            const
                self = this;
            
            self.parameters = parameters || {};
            
            self.timeline_type = TIMELINE_TYPE.unknown;
            self.api_type_in_use = API_TYPE_IN_USE.same_as_timeline_type;
            self.timeline_status = TIMELINE_STATUS.init;
            
            self.tweet_info_list = [];
            
            let max_tweet_id = self.requested_max_tweet_id = self.max_tweet_id = parameters.max_tweet_id,
                max_timestamp_ms = self.requested_max_timestamp_ms = self.max_timestamp_ms = parameters.max_timestamp_ms;
            
            if ( ! max_tweet_id ) {
                if ( max_timestamp_ms ) {
                    self.max_tweet_id = get_tweet_id_from_utc_sec( max_timestamp_ms / 1000.0 );
                }
                else {
                    self.max_tweet_id = new Decimal( DEFAULT_UNTIL_ID ).sub( 1 ).toString();
                }
            }
            
            return self;
        } // end of constructor()
        
        async fetch_tweet_info() {
            return null;
        } // end of fetch_tweet_info()
        
        get api_called_info() {
            const
                self = this,
                timeline_type = ( self.api_type_in_use === API_TYPE_IN_USE.same_as_timeline_type ) ? self.timeline_type : self.api_type_in_use,
                api_called_info = TWITTER_API.api_called_infos[ timeline_type ];
            
            return api_called_info;
        } // end of get api_called_info(()
        
    }, // end of class ClassTimelineTemplate
    
    ClassUserTimeline = class extends ClassTimelineTemplate {
        constructor( parameters ) {
            super( parameters );
            
            const
                self = this;
            
            self.timeline_type = TIMELINE_TYPE.user;
            
            parameters = self.parameters;
            
            let max_tweet_id = self.max_tweet_id,
                max_timestamp_ms = self.max_timestamp_ms,
                screen_name = self.screen_name = parameters.screen_name;
            
            if ( ( ! max_tweet_id ) && ( max_timestamp_ms ) ) {
                self.api_type_in_use = API_TYPE_IN_USE.search;
            }
            
            self.timeline_status = TIMELINE_STATUS.search;
            
            return self;
        } // end of constructor()
        
        async fetch_tweet_info() {
            const
                self = this;
            
            let tweet_info = self.tweet_info_list.shift(),
                fetch_tweets;
            
            log_debug( 'fetch_tweet_info(): tweet_info=', tweet_info, 'remain count:', self.tweet_info_list.length, 'timeline status:', self.timeline_status, 'api_type_in_use:', self.api_type_in_use )
            
            if ( tweet_info ) {
                return tweet_info;
            }
            
            switch ( self.timeline_status ) {
                case TIMELINE_STATUS.search :
                    if ( self.api_type_in_use == API_TYPE_IN_USE.search ) {
                        fetch_tweets = self.fetch_tweets_from_search_timeline;
                    }
                    else {
                        fetch_tweets = self.fetch_tweets_from_user_timeline;
                    }
                    break;
                
                default :
                    return null;
            }
            
            await fetch_tweets.call( self ).catch( ( error ) => {
                log_error( 'fetch_tweets.call():', error );
                return null;
            } );
            
            tweet_info = await self.fetch_tweet_info().catch( ( error ) => {
                log_error( 'self.fetch_tweet_info():', error );
                self.timeline_status = TIMELINE_STATUS.error;
                return null;
            } );
            
            return tweet_info;
        } // end of fetch_tweet_info()
        
        async fetch_tweets_from_user_timeline() {
            const
                self = this;
            
            let result = await TIMELINE_TOOLBOX.get_user_timeline_info( {
                    screen_name : self.screen_name,
                    max_id : self.max_tweet_id,
                    count : TWITTER_API.API_DEFINITIONS[ TIMELINE_TYPE.user ].tweet_number.limit,
                } ).catch( ( error ) => {
                    log_error( 'TIMELINE_TOOLBOX.get_user_timeline_info():', error );
                    return null;
                } );
            
            if ( ( ! result ) || ( ! result.timeline_info ) ) {
                self.timeline_status = TIMELINE_STATUS.error;
                return;
            }
            
            let tweet_info_list = result.timeline_info.tweet_info_list;
            
            if ( tweet_info_list.length <= 0 ) {
                self.api_type_in_use = API_TYPE_IN_USE.search
                return;
            }
            
            self.tweet_info_list = self.tweet_info_list.concat( tweet_info_list );
            self.max_tweet_id = new Decimal( tweet_info_list[ tweet_info_list.length - 1 ].id ).sub( 1 ).toString();
        } // end of fetch_tweets_from_user_timeline()
        
        async fetch_tweets_from_search_timeline() {
            const
                self = this;
            
            let query = 'from:' + self.screen_name + ' include:retweets include:nativeretweets ';
            
            if ( self.max_tweet_id ) {
                query += 'max_id:' + self.max_tweet_id;
            }
            else {
                query += 'until:' + get_gmt_datetime( self.max_timestamp_ms + 1, true );
            }
            
            let result = await TIMELINE_TOOLBOX.get_search_timeline_info( query, {
                    count : TWITTER_API.API_DEFINITIONS[ TIMELINE_TYPE.search ].tweet_number.limit,
                } ).catch( ( error ) => {
                log_error( 'TIMELINE_TOOLBOX.get_search_timeline_info():', error );
                return null;
            } );
            
            if ( ( ! result ) || ( ! result.timeline_info ) ) {
                self.timeline_status = TIMELINE_STATUS.error;
                return;
            }
            
            let tweet_info_list = result.timeline_info.tweet_info_list;
            
            if ( tweet_info_list.length <= 0 ) {
                self.timeline_status = TIMELINE_STATUS.end;
                return;
            }
            
            self.tweet_info_list = self.tweet_info_list.concat( tweet_info_list );
            self.max_tweet_id = new Decimal( tweet_info_list[ tweet_info_list.length - 1 ].id ).sub( 1 ).toString();
        } // end of fetch_tweets_from_search_timeline()
    }, // end of class ClassUserTimeline
    
    
    ClassSearchTimeline = class extends ClassTimelineTemplate {
        constructor( parameters ) {
            super( parameters );
            
            const
                self = this;
            
            self.timeline_type = TIMELINE_TYPE.search;
            
            parameters = self.parameters;
            
            let max_tweet_id = self.max_tweet_id,
                max_timestamp_ms = self.max_timestamp_ms,
                specified_query = self.specified_query = parameters.specified_query || '',
                filter_info = self.filter_info = parameters.filter_info || {};
                // filter_info
                //  .use_media_filter : クエリ内のメディアフィルタ用コマンドを使用(true/false)
                //  .image : 画像フィルタコマンド使用(true/false)
                //  .gif : GIFフィルタコマンド使用(true/false)
                //  .video : VIDEOフィルタコマンド使用(true/false)
                //  .nomedia : メディアなしツイート含む(true/false) ※ true 時は .use_media_filter 無効
            
            let query_base = specified_query;
            
            // 期間指定コマンドの削除
            query_base = query_base.replace( /-?(?:since|until|since_id|max_id):[^\s]+(?:\s+OR\s+)?/g, ' ' );
            
            if ( filter_info.use_media_filter ) {
                // 本スクリプトと競合するフィルタの削除
                query_base = query_base
                    .replace( /-?filter:(?:media|periscope)(?:\s+OR\s+)?/g, ' ' )
                    .replace( /-?filter:(?:images)(?:\s+OR\s+)?/g, ' ' )
                    .replace( /-?card_name:animated_gif(?:\s+OR\s+)?/g, ' ' )
                    .replace( /-?filter:(?:videos|native_video|vine)(?:\s+OR\s+)?/g, ' ' );
                
                if ( ! filter_info.nomedia ) {
                    let filters = [];
                    
                    if ( filter_info.image ) {
                        filters.push( 'filter:images' );
                    }
                    if ( filter_info.gif ) {
                        filters.push( 'card_name:animated_gif' );
                    }
                    if ( filter_info.video ) {
                        filters.push( 'filter:videos' );
                        filters.push( 'filter:native_video' );
                        filters.push( 'filter:vine' );
                    }
                    query_base += ' ' + filters.join( ' OR ' );
                }
            }
            
            self.query_base = query_base.replace( /\s+/g, ' ' ).trim();
            
            self.timeline_status = TIMELINE_STATUS.search;
            
            return self;
        } // end of constructor()
        
        async fetch_tweet_info() {
            const
                self = this;
            
            let tweet_info = self.tweet_info_list.shift(),
                fetch_tweets;
            
            if ( tweet_info ) {
                return tweet_info;
            }
            
            switch ( self.timeline_status ) {
                case TIMELINE_STATUS.search :
                    break;
                
                default :
                    return null;
            }
            
            await self.fetch_tweets().catch( ( error ) => {
                log_error( 'self.fetch_tweets():', error );
                return null;
            } );
            
            tweet_info = await self.fetch_tweet_info().catch( ( error ) => {
                log_error( 'self.fetch_tweet_info():', error );
                self.timeline_status = TIMELINE_STATUS.error;
                return null;
            } );
            
            return tweet_info;
        } // end of fetch_tweet_info()
        
        async fetch_tweets() {
            const
                self = this;
            
            let query = self.query_base + ' ';
            
            if ( self.max_tweet_id ) {
                query += 'max_id:' + self.max_tweet_id;
            }
            else {
                query += 'until:' + get_gmt_datetime( self.max_timestamp_ms + 1, true );
            }
            
            let result = await TIMELINE_TOOLBOX.get_search_timeline_info( query, {
                    count : TWITTER_API.API_DEFINITIONS[ TIMELINE_TYPE.search ].tweet_number.limit,
                } ).catch( ( error ) => {
                log_error( 'TIMELINE_TOOLBOX.get_search_timeline_info():', error );
                return null;
            } );
            
            if ( ( ! result ) || ( ! result.timeline_info ) ) {
                self.timeline_status = TIMELINE_STATUS.error;
                return;
            }
            
            let tweet_info_list = result.timeline_info.tweet_info_list;
            
            if ( tweet_info_list.length <= 0 ) {
                self.timeline_status = TIMELINE_STATUS.end;
                return;
            }
            
            self.tweet_info_list = self.tweet_info_list.concat( tweet_info_list );
            self.max_tweet_id = new Decimal( tweet_info_list[ tweet_info_list.length - 1 ].id ).sub( 1 ).toString();
        } // end of fetch_tweets()
    }, // end of class ClassSearchTimeline
    
    CLASS_TIMELINE_SET = {
        [ TIMELINE_TYPE.user ] : ClassUserTimeline,
        [ TIMELINE_TYPE.search ] : ClassSearchTimeline,
    };


Object.assign( exports, {
    version : VERSION,
    module_name : MODULE_NAME,
    debug_mode : DEFAULT_DEBUG_MODE,
    
    logged_script_name : DEFAULT_SCRIPT_NAME,
    log_debug,
    log,
    log_info,
    log_error,
    
    TIMELINE_TYPE,
    TIMELINE_STATUS,
    REACTION_TYPE,
    MEDIA_TYPE,
    
    TWITTER_API,
    TIMELINE_TOOLBOX,
    
    CLASS_TIMELINE_SET,
} );

} )( ( typeof exports != 'undefined' ) ? exports : context_global[ MODULE_NAME ] = {} );

} )();