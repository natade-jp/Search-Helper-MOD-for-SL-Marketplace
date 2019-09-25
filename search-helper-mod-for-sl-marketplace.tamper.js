// ==UserScript==
// @name         Search Helper MOD for SL Marketplace
// @namespace    https://github.com/natade-jp/
// @version      0.11
// @description  Add functions on site of Second Life Marketplace. (Unofficial)
// @author       2019, natade
// @match        https://marketplace.secondlife.com/*
// @grant        none
// ==/UserScript==
//@ts-check

(function() {
	"use strict";
	
	// Add functions on site of Second Life Marketplace.
	// - Infinite-Scroll
	// - Zoom (Valid only for "list" or "thumbnail" display. )

	// 画像についてのメモ
	// 100x100
	// https://slm-assets[0-4].secondlife.com/assets/12345/thumbnail/ABC.jpg
	// 165x165
	// https://slm-assets[0-4].secondlife.com/assets/12345/view_small/ABC.jpg
	// 345x345, 460x290
	// https://slm-assets[0-4].secondlife.com/assets/12345/view_large/ABC.jpg
	// 700x442
	// https://slm-assets[0-4].secondlife.com/assets/12345/lightbox/ABC.jpg
	// 負荷分散のためにウェブサーバーを分けているようである。
	// 基本的にはランダムなサーバーを選んでいると思われるが、
	// 動作としては thumbnail と lightbox は同じサーバーになるようである。
	// 何が選択されるのか知ることはできないのだろうか？
	// 
	// ちなみに list表示, thumbnails表示 だと thumbnail画像が使用される。
	// gallery表示 だと view_small画像が使用される。
	// view_small画像ならまだ何かわかるが、thumbnail画像は小さくてよくわからない場合がある。
	// 結局クリックしないと中が見えないため、余計なアクセス負荷がかかるので、直接見ることが出来れば負荷軽減になる
	//
	// 個人的には、lightboxの「700x442」サイズは不要であり、「view_large」で画質は十分だと思っている。
	// 従って、もし中身の画像を直接、見ることが出来るのであれば「view_large」でよいと思われる。

	// アイコンについてのメモ
	// ウェブサイトのいたるところで以下のアイコンが利用されている
	// これもサーバーが分かれているようである
	// https://marketplace.secondlife.com/assets/slm/sprites/marketplace-sprite-d278290e53d82c4cf61802b189f62bfc.png
	// https://slm-assets2.secondlife.com/assets/slm/sprites/marketplace-sprite-d278290e53d82c4cf61802b189f62bfc.png
	// 虫眼鏡のアイコンとかはここからとるという方法もあるが、
	// BASE64で埋め込むか、絵文字🔍を使う方法でもよいと思われる。

	/**
	 * クエリを除いたページURL
	 * @type {string}
	 */
	let href_site;

	/**
	 * URLのクエリ(URLデコード済み)
	 * @type {string}
	 */
	let href_query;

	/**
	 * 読み込みたいページのオフセット
	 * @type {number}
	 */
	let href_next_page_offset;

	/**
	 * 読み込んだページ数
	 * @type {number}
	 */
	let count_loaded_page = 0;

	/**
	 * 今見ているページ番号
	 * @type {number}
	 */
	let href_page;

	/**
	 * 1ページ当たりの表示数
	 * @type {number}
	 */
	let href_per_page;

	/**
	 * 最大のページ番号
	 * @type {number}
	 */
	let href_page_max;

	/**
	 * ロード済みのプロダクトID
	 * @type {Object<string, boolean>}
	 */
	let product_id_table = {};

	/**
	 * 実行中かどうかのフラグ
	 */
	let is_load_next_page = false;

	/**
	 * 何表示ごと読みだすか
	 * 
	 * 実際には96ごとに読み出すとロード回数が減るため負荷が下がり効率がいい。
	 * しかし現状、クッキーで記憶するというサイト構造であるため、URLで指定できない。
	 */
	let PER_PAGE = 96;

	/**
	 * レイアウトの種類
	 * 
	 * この種類によっては格納方法が変わる
	 * - list
	 * - gallery
	 * - thumbnails
	 */
	let href_layout = "";

	/**
	 * 型のみの情報
	 * @typedef {Object} WindowSize
	 * @property {number} max_height 全体の縦幅
	 * @property {number} height 画面の縦幅
	 * @property {number} top スクロール座標
	 * @property {number} bottom スクロール座標の下の座標
	 */

	/**
	 * スクロール位置を取得する
	 * @returns {WindowSize}
	 */
	const getScrollPosition = function() {
		// Second Life は body の要素を取得しても縦幅は取得できない
		const height = document.getElementsByTagName("div")[0].clientHeight;
		/**
		 * @type {WindowSize}
		 */
		const size = {
			max_height : height,
			height : document.documentElement.clientHeight,
			top : window.pageYOffset,
			bottom : window.pageYOffset + document.documentElement.clientHeight
		}
		return size;
	};

	/**
	 * 指定したページ番号のサイトを取得する
	 * @param {number} page
	 * @returns {string}
	 */
	const getURL = function(page) {
		if((page < 1) || (href_page_max < page)) {
			return "";
		}
		let url = href_query;
		// search[page]=x を書き換える
		url = url.replace(/search\[page\]=[0-9]+/, "search[page]=" + page);
		// search[per_page]=x を書き換える(無駄なアクセスを減らすため96個ずつ取得する)
		url = url.replace(/search\[per_page\]=[0-9]+/, "search[per_page]=" + PER_PAGE);
		return href_site + "?" + encodeURI(url);
	};

	/**
	 * 検索結果部分のみを抽出する
	 * @param {string} html
	 * @returns {string} nullで失敗
	 */
	const extractSearchResults = function(html) {
		// 以下の2つの間を抜き出す。
		// <div class="clear column span-6 last product-listing gallery">
		// <div class="column span-6 last footer-paginate"></div>
		/**
		 * @type {string}
		 */
		let x = html;
		const posProductListing = x.match(/<div class="[^"]*product-listing[^"]*">/);
		if(!posProductListing) {
			return null;
		}
		x = x.substring(posProductListing.index);
		const posFooterPaginate = x.match(/<div class="[^"]*footer-paginate[^"]*">/);
		if(!posFooterPaginate) {
			return null;
		}
		x = x.substring(0, posFooterPaginate.index);
		return x;
	};

	/**
	 * 指定したサイトをダウンロードする
	 * @param {string} url
	 * @param {function(string): void} callback 
	 */
	const getWebPage = function(url, callback) {
		const http = new XMLHttpRequest();
		if(http === null) {
			return null;
		}
		const handleHttpResponse = function (){
			if(http.readyState === 4) { // DONE
				if(http.status !== 200) {
					console.log("error download " + url);
					return null;
				}
				callback(http.responseText);
			}
		};
		http.onreadystatechange = handleHttpResponse;
		http.open("GET", url, true);
		http.send(null);
	};

	/**
	 * ズーム機能を追加する
	 * @param {HTMLDivElement} div_node 画像が入ったDIV要素
	 */
	const attachDivNodeForZoom = function(div_node) {
		if(href_layout === "gallery") {
			// ギャラリー表示はサイズが大きいので省略
			return;
		}

		/**
		 * クリック時の動作
		 * @param {Event} e
		 */
		const onClick = function(e) {
			const target = e.target;
			// @ts-ignore
			const url = target.dataset.linkTarget;
			let is_close = false;

			/**
			 * 閉じる
			 * @param {Event} e
			 */
			const close = function(e) {
				if(is_close) {
					return;
				}
				document.body.removeChild(zoom_screen);
				is_close = true;
			}

			// スタイルの作成
			const zoom_screen = document.createElement("div");
			zoom_screen.style.cursor = "zoom-out";
			zoom_screen.style.display = "table";
			zoom_screen.style.position = "fixed";
			zoom_screen.style.top = "0px";
			zoom_screen.style.left = "0px";
			zoom_screen.style.width = "100%";
			zoom_screen.style.height = "100%";
			zoom_screen.style.zIndex = "9998";
			zoom_screen.style.backgroundColor = "rgba(34, 34, 34, 0.6)";

			const center_v = document.createElement("div");
			center_v.style.cursor = "zoom-out";
			center_v.style.position = "static";
			center_v.style.display = "table-cell";
			center_v.style.verticalAlign = "middle";

			const center_h = document.createElement("div");
			center_h.style.cursor = "zoom-out";
			center_h.style.marginLeft = "auto";
			center_h.style.marginRight= "auto";
			center_h.style.textAlign = "center";
			center_h.style.height = "auto";
			center_h.style.width = "700px";
			center_h.style.borderRadius = "5px";
			center_h.style.backgroundColor = "white";
			center_h.style.padding = "1em";
			center_h.innerHTML = "<img src=" + url + ">";

			// イベントを付ける
			zoom_screen.addEventListener("click", close);
			center_v.addEventListener("click", close);
			center_h.addEventListener("click", close);

			// 接合
			center_v.appendChild(center_h);
			zoom_screen.appendChild(center_v);
			document.body.appendChild(zoom_screen);
		}

		/**
		 * 画像データが入ったdivに対して編集する
		 * @param {Element} target_node 商品内の画像用DIVデータ
		 */
		const attachImageDiv = function(target_node) {
			const search_max = 5;
			let image_url = null;
			let check_node = target_node;
			for(let i = 0 ; i < search_max; i++) {
				if(!check_node) {
					return;
				}
				if(check_node.tagName === "IMG") {
					image_url = check_node.getAttribute("src");
					break;
				}
				check_node = check_node.firstElementChild;
			}
			if(image_url === null) {
				return;
			}
			if(!/\/thumbnail\//.test(image_url)) {
				return;
			} 
			// @ts-ignore
			target_node.style.position = "relative";
			// 画像の上に文字をかぶせる
			const layer = document.createElement("div");
			layer.innerText = "🔍";
			layer.style.position = "absolute";
			layer.style.right = "0";
			layer.style.bottom = "0";
			layer.style.boxSizing = "border-box";
			layer.style.cursor = "zoom-in";
			// 画像ファイルのアドレスを保存する
			layer.dataset.linkTarget = image_url.replace("/thumbnail/", "/lightbox/");
			layer.addEventListener("click", onClick);
			target_node.appendChild(layer);
		}

		attachImageDiv(div_node);
	}

	/**
	 * 次のページをバッググラウンドでダウンロードして下に表示する
	 */
	const getNextPage = function() {
		if(is_load_next_page) {
			return;
		}
		is_load_next_page = true;
		const get_page_num = href_next_page_offset + count_loaded_page;
		const onLoad = function(load_html_text) {
			const html_text = extractSearchResults(load_html_text);
			const html = document.createElement("div");
			html.innerHTML = html_text;
			const product_div = html.children;
			
			// 追加するdivを抽出する
			// - すでにロードしている物はIDを見て省く
			// - 追加する際にズーム機能も付与する
			let add_div = [];
			{
				// サムネイル表示の場合
				if((href_layout === "thumbnails")) {
					// 選別
					{
						const div_parent = product_div[0].children;
						for(let row = 0; row < div_parent.length; row++) {
							const product_list = div_parent[row].children;
							for(let col = 0; col < product_list.length; col++) {
								if(!product_id_table[product_list[col].id]) {
									// @ts-ignore
									attachDivNodeForZoom(product_list[col]);
									add_div.push(product_list[col]);
									product_id_table[product_list[col].id] = true;
								}
							}
						}
					}

					const temp_div = add_div;
					add_div = [];

					// サムネイル用の表示データを作成
					{
						// サムネイル表示の場合
						// 1	行は class="column span-6 last result-row"
						// 1-5	つ目は class="column span-1"
						// 6	つ目は class="column span-1 last"
						const COLUMN_MAX = 6;
		
						const row_max = Math.ceil(temp_div.length / COLUMN_MAX);
						let num = 0;
		
						for(let row = 0 ; row < row_max; row++ ) {
							const row_div = document.createElement("div");
							row_div.className = "column span-6 last result-row";
							for(let col = 0 ; col < COLUMN_MAX; col++ ) {
								if(num === temp_div.length) {
									continue;
								}
								const col_div = temp_div[num];
								if(col < COLUMN_MAX - 1) {
									col_div.className = "column span-1";
								}
								else {
									col_div.className = "column span-1 last";
								}
								row_div.appendChild(col_div);
								num++;
							}
							add_div.push(row_div);
						}
					}
				}
				// サムネイル表示以外の場合
				else {
					const product_list = product_div[0].children;
					for(let i = 0; i < product_list.length; i++) {
						if(!product_id_table[product_list[i].id]) {
							// @ts-ignore
							attachDivNodeForZoom(product_list[i].firstElementChild);
							add_div.push(product_list[i]);
							product_id_table[product_list[i].id] = true;
						}
					}
				}
			}
			
			// 最終行に表示
			{
				const product_div = document.getElementsByClassName("product-listing")[0];
				const page = document.createElement("div");
				page.style.textAlign = "center";
				page.style.height = "1.5em";
				page.style.width = "100%";
				page.style.display = "inline";
				page.style.cssFloat = "left";
				page.style.marginTop = "0em";
				page.style.marginBottom = "0.8em";
				page.style.paddingTop = "0.5em";
				page.style.paddingBottom = "0em";
				page.style.backgroundColor = "#e8e8e8";
				page.style.borderRadius = "5px";
				page.style.border = "1px solid #ccc";
				page.style.backgroundImage = "-webkit-gradient(linear, 0 0, 0 100%, from(#fefefe), to(#e8e8e8))";
				page.innerHTML = "<a href = " + url + ">" + get_page_num + " / " + href_page_max + "</a>";
				product_div.appendChild(page);

				for(let i = 0 ; i < add_div.length; i++ ) {
					product_div.appendChild(add_div[i]);
				}
			}
			
			is_load_next_page = false;
		}
		const url = getURL(get_page_num);
		getWebPage(url, onLoad);
		count_loaded_page++;
	};

	/**
	 * タイマーイベント
	 */
	const onTimer = function() {
		const position = getScrollPosition();
		const height = position.max_height - position.bottom;
		// スクロール位置が下にある場合は次のページを読み込む
		if(height < 500) {
			getNextPage();
		}
	};

	/**
	 * 初期化を行う
	 */
	const initFunction = function() {

		// 商品の紹介ページかどうか
		const is_p_page = /https:\/\/marketplace\.secondlife\.com\/p\//.test(location.href);

		if(is_p_page) {
			// 商品の紹介ページの場合は、関連商品にズーム機能を付ける
			const product_div = document.getElementById("product-related-items");
			if(!product_div) {
				return;
			}
			const div_node = product_div.children;
			// リスト表示
			for(let i = 0; i < div_node.length; i++) {
				if(div_node[i].tagName === "DIV") {
					// @ts-ignore
					attachDivNodeForZoom(div_node[i]);
				}
			}
			return;
		}

		// 今見ているページ
		const current_page_node = document.querySelector(".pagination .current");
		if(current_page_node) {
			// ページ番号があるページの場合は以下も調査する

			// 次のページなどのリンク先
			const url_for_page_transition_node = document.querySelector(".pagination a");
			if(!url_for_page_transition_node) {
				return;
			}

			// 次のページなどのURLなどを取得する
			// @ts-ignore
			const href = url_for_page_transition_node.href;
			href_page = parseFloat(current_page_node.textContent);
			href_site = href.match(/^[^?]+/)[0];
			href_query = /\?.*/.test(href) ? decodeURIComponent(href.match(/\?(.*)/)[1]) : "";

			// 表示方法を調査する
			// search[layout]=x を取得する
			href_layout = /search\[layout\]=\w+/.test(href_query) ? href_query.match(/search\[layout\]=(\w+)/)[1] : "gallery"; 
		}
		else {
			// ページ番号がない場合は、URLを利用して調査する
			const href_decode = decodeURIComponent(location.href);

			// 表示方法を調査する
			// search[layout]=x を取得する
			href_layout = /search\[layout\]=\w+/.test(href_decode) ? href_decode.match(/search\[layout\]=(\w+)/)[1] : "gallery"; 
			if((href_layout !== "list") && (href_layout !== "gallery") && (href_layout !== "thumbnails")) {
				return;
			}
		}

		// 画像データにズーム機能を追加する
		{
			const product_div = document.getElementsByClassName("product-listing");
			if(product_div.length === 0) {
				return;
			}
			const div_node = product_div[0].children;
			if(href_layout === "thumbnails") {
				// サムネイル表示
				for(let row = 0; row < div_node.length; row++) {
					const product_list = div_node[row].children;
					for(let col = 0; col < product_list.length; col++) {
						// @ts-ignore
						attachDivNodeForZoom(product_list[col]);
					}
				}
			}
			else {
				// リスト表示
				for(let i = 0; i < div_node.length; i++) {
					// @ts-ignore
					attachDivNodeForZoom(div_node[i].firstElementChild);
				}
			}
		}

		// 自分が見ているページが分からない場合は、ここで終了
		if(!current_page_node) {
			return;
		}

		// 以下は次のページを自動的に表示する機能
		// 検索画面であることのチェックと、次のページを開く必要があるかのチェックを行う
		{
			// サーチ画面かどうかを判定
			const href = document.location.href;
			if(href.indexOf("products/search") < 0) {
				return;
			}
			const noSearchResultsContainer = document.getElementById("search-results-container");
			if(!noSearchResultsContainer) {
				return;
			}
		}

		// 1ページ当たりの表示数
		// @ts-ignore
		href_per_page = parseFloat(document.getElementById("per_page").value);

		// ロードする1ページ当たりの表示数
		// 実際は 96 がサーバー負荷的に効率がいいが、現状クッキーがデータを持っている可能性があり、現在の設定の表示数に合わせる
		PER_PAGE = href_per_page;

		// 読み込みたいページのオフセット
		href_next_page_offset = 1 + Math.floor(href_page * href_per_page / PER_PAGE);

		// 最大の検索結果を取得
		{
			const resultsTitle = document.querySelector(".results-title");
			if(!resultsTitle) {
				return;
			}
			const text = resultsTitle.textContent;
			const max_num = parseFloat(text.match(/\d+/)[0]);
			href_page_max = Math.floor(max_num / PER_PAGE) + 1;
		}

		// 現在表示中のページをバッファに記録する
		{
			// サムネイル表示とそうではないとで、HTMLが違うので切り替える
			const product_div = document.getElementsByClassName("product-listing");
			if((href_layout === "thumbnails")) {
				const div_parent = product_div[0].children;
				for(let row = 0; row < div_parent.length; row++) {
					const product_list = div_parent[row].children;
					for(let col = 0; col < product_list.length; col++) {
						product_id_table[product_list[col].id] = true;
					}
				}
			}
			else {
				const product_list = product_div[0].children;
				for(let i = 0; i < product_list.length; i++) {
					product_id_table[product_list[i].id] = true;
				}
			}
		}

		{
		//	console.log(href_layout);
		//	console.log(href_per_page);
		//	console.log(product_id_table);
		//	console.log(href_site);
		//	console.log(href_query);
		//	console.log(href_page);
		//	console.log(href_page_max);
		//	console.log(getURL(3));
		}

		setInterval(onTimer, 500);
	};

	window.addEventListener("load", initFunction, false);

})();


