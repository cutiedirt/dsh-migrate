# 浠诲姟涔?P1锛歾std 甯х紪瑙ｇ爜 + sessions 姝ラ + 娴嬭瘯

> 鎵ц鑰咃細Codex銆備粨搴擄細`D:\dshworkspace\dsh-migrate`锛圵indows 璺緞锛夈€?> 鍙厑璁镐慨鏀?鏂板涓嬮潰銆屽厑璁告敼鍔ㄣ€嶅垪鍑虹殑鏂囦欢锛?*涓嶈鍔?* `bin/`銆乣lib/util.mjs`銆?> `lib/config.mjs`銆乣lib/manifest.mjs`銆乣docs/`銆乣test/make-fixtures.mjs`銆乣package.json`銆?
## 0. 鍏堝缓浜х墿鍐嶅共娲?
鍔ㄦ墜鍓嶅厛鍒涘缓 `D:\dsh-ref\.codex-tasks\report-p1-frames.md`锛?*姣忓畬鎴愪竴鑺傚氨杩藉姞**锛?宸叉敼鏂囦欢銆佸叧閿喅绛栥€佽窇杩囩殑鍛戒护涓庣粨鏋溿€傝涓柇涔熻鐣欎笅閮ㄥ垎浜у嚭銆?
## 1. 鑳屾櫙锛堝繀椤荤悊瑙ｏ紝鍚﹀垯浼氬啓閿欙級

DSH 浼氳瘽鏃ュ織 `session.<v>.jsonl.zstd` 鏄?*澶氬抚** zstd 娴侊細

```
甯?      = 涓€琛?JSON锛堜細璇?header锛歿"type":"session","version":4,"id":鈥?"cwd":鈥?鈥锛?甯?..N   = 涔嬪悗姣忔 append 鐨勪竴鎵?JSONL 浜嬩欢锛堟瘡甯у琛岋級
```

Node 鐨?`zstdDecompressSync(wholeFile)` **鍙В绗竴甯?*灏辫繑鍥炪€傛浘缁忔湁浜?鏁存枃浠惰В鍘嬪啀閲嶅帇"锛?鎶?111 浠戒細璇濆啓鎴愬彧鍓?header锛?73KB 鈫?201B锛夛紝鐢ㄦ埛鐐瑰紑浼氳瘽鐩存帴 `SessionFormatError`銆?
鍥犳鏈换鍔＄殑鏍稿績鏄細**鑳界簿纭垏甯?*銆?*鍙噸缂栫爜绗竴甯?*銆?*鏂█鍏朵綑瀛楄妭鍘熸牱淇濈暀**銆?
## 2. 闇€瑕佸疄鐜扮殑涓滆タ

### A. `lib/frames.mjs`锛堟妸鐜版湁 stub 鎹㈡垚鐪熷疄瀹炵幇锛岀鍚嶄笌 JSDoc 淇濇寔涓嶅彉锛?
瀵煎嚭锛歚scanFrames(buf)`銆乣decodeFrames(buf)`銆乣encodeFrame(text)`銆乣readHeader(buf)`銆?`rewriteFirstFrame(buf, patch)`銆佸父閲?`FRAME_MAGIC`銆?
**鍒囧抚蹇呴』闈犺嚜宸辫В鏋愬抚缁撴瀯锛堜笉瑕侀潬 `bytesWritten` 鎴?鑳戒笉鑳借В鍘?鏉ヨ瘯鎺級**锛?
Zstd 甯ф牸寮忥紙灏忕锛夛細
1. `Magic_Number` 4 瀛楄妭 = `0xFD2FB528`锛堝瓧鑺傚簭 `28 B5 2F FD`锛夈€?   - 鑻ヤ负 `0x184D2A50..0x184D2A5F` 鈫?**skippable frame**锛? 瀛楄妭 magic + 4 瀛楄妭 size + size 瀛楄妭 payload锛屾暣甯ц烦杩囥€?2. `Frame_Header_Descriptor`锛團HD锛? 瀛楄妭锛?   - bit7-6 `Frame_Content_Size_flag`锛團CS_flag锛?   - bit5 `Single_Segment_flag`
   - bit2 `Content_Checksum_flag`（**注意：不是 bit3，bit3 是 Reserved_bit**）
   - bit1-0 `Dictionary_ID_flag`
3. 鑻?`Single_Segment_flag == 0`锛歚Window_Descriptor` 1 瀛楄妭銆?4. `Dictionary_ID`锛氭寜 flag 鍙?0 / 1 / 2 / 4 瀛楄妭锛?鈫?锛?鈫?锛?鈫?锛?鈫?锛夈€?5. `Frame_Content_Size`锛?   - `Single_Segment_flag == 1`锛欶CS_flag=0 鈫?1 瀛楄妭锛? 鈫?2 瀛楄妭锛? 鈫?4 瀛楄妭锛? 鈫?8 瀛楄妭
   - `Single_Segment_flag == 0`锛欶CS_flag=0 鈫?**0 瀛楄妭**锛? 鈫?2锛? 鈫?4锛? 鈫?8
6. Blocks 寰幆锛氭瘡鍧?3 瀛楄妭 `Block_Header`锛?   - bit0 `Last_Block`锛沚it1-2 `Block_Type`锛?=Raw, 1=RLE, 2=Compressed, 3=Reserved锛?   - bit3-23 `Block_Size`
   - 鏁版嵁闀垮害锛歊aw 鈫?Block_Size锛汻LE 鈫?1锛汣ompressed 鈫?Block_Size
   - 閬囧埌 `Last_Block == 1` 缁撴潫鏈抚銆?7. 鏍￠獙杈圭晫涓嶅緱瓒婄晫锛涜秺鐣?鈫?鎶涘甫鏂囦欢鍋忕Щ鐨勯敊璇紙`code = 'EZSTD_TRUNCATED'`锛夈€?
**`scanFrames(buf)`** 杩斿洖 `{ frames:[{start,end,skippable}], bytes, trailing }`锛?`trailing` 蹇呴』涓?0锛屽惁鍒欒涓烘埅鏂紙`decodeFrames` 閬囧埌 trailing>0 鎶涢敊锛夈€?
**`decodeFrames(buf)`**锛氶€愬抚 `zstdDecompressSync(buf.subarray(start,end))` 鍚庢嫾鎺ユ垚瀛楃涓层€?
**`readHeader(buf)`**锛氳В绗竴甯?鈫?鍙栫涓€琛?鈫?`JSON.parse`锛岃繑鍥?`{header, rawFirstLine, frameEnd}`銆?
**`rewriteFirstFrame(buf, patch)`**锛?- 瑙ｅ抚0 鈫?鍙栭琛?鈫?parse 鈫?`Object.assign(header, patch)` 鈫?`JSON.stringify` + `'\n'`锛?- 鏂板抚0 = `zstdCompressSync(鏂版枃鏈?`锛?- 鏂?buffer = `Buffer.concat([鏂板抚0, buf.subarray(frame0End)])`锛?- **鏂█**锛歚鏂癰uffer.subarray(鏂板抚0.length)` 涓?`buf.subarray(frame0End)` 閫愬瓧鑺傜浉绛夛紝涓嶇瓑鍒欐姏閿欙紱
- 杩斿洖 `{buffer, before, after, frameEnd}`銆?
### B. `lib/steps/sessions.mjs`锛堟妸 stub 鎹㈡垚鐪熷疄瀹炵幇锛?
閰嶇疆娈碉紙`sectionOf(cfg,'sessions')`锛夛細

```json
{ "root": "D:\\x\\sessions", "cwdMap": [ { "from": "D:\\proj-old", "to": "D:\\proj-new" } ] }
```

- 鍙戠幇锛歚root/<projectKeyDir>/<sessionDir>/*.jsonl.zstd`锛?*鍙浠?`.zstd` 缁撳熬鐨?*锛宍session.v3/v4` 閮借锛夈€?- 鍖归厤锛氭寜 `cwdMap` 閲?`from` 涓?header.cwd **瀹屽叏鐩哥瓑**锛堝ぇ灏忓啓鏁忔劅锛岃矾寰勪笉鍋氳鑼冨寲锛夈€?- `plan(section,{log})` 鈫?`{counts:{files,toRewrite,alreadyOk,skippedNonZstd,unreadable},actions:[{file,from,to,frameCount}]}`锛?*鍙**銆?- `apply(section,{log,manifest,write})`锛?  - 瀵规瘡涓緟鏀规枃浠讹細`backupFile(manifest, file)` 鈫?`rewriteFirstFrame` 鈫?鍐欏洖锛坄write===false` 鏃朵笉鍐欙紝鍙粺璁?`wouldChange`锛夛紱
  - 閫愭枃浠?try/catch锛屽け璐ユ敹闆嗚繘 `errors`锛?*涓嶄腑鏂暣鎵?*锛?  - 杩斿洖 `{changed, wouldChange, unchanged, errors:[{file,message}]}`锛?  - 鍐欏畬蹇呴』**鍥炶**锛氶噸鏂?`readHeader` 纭 cwd 宸叉槸鐩爣锛涗笉涓€鑷磋 `errors`銆?- `verify(section,{log})` 鈫?`{files, decodedOk, badFrames, cwdHistogram, mismatched:[{file,cwd,expect}]}`銆?
### C. `test/frames.test.mjs`锛堢敤 `node --test`锛?
蹇呴』瑕嗙洊锛?1. 澶瑰叿锛坄test/make-fixtures.mjs` 鐢熸垚鐨勪笁浠斤級鑳借 `scanFrames` 鍒囨垚 **4 甯?*銆乣decodeFrames` 琛屾暟姝ｇ‘锛?2. `rewriteFirstFrame` 鍚庯細header.cwd 宸插彉銆?*灏鹃儴瀛楄妭瀹屽叏涓€鑷?*銆佸抚鏁颁笉鍙橈紱
3. `readHeader` 瀵?`session.v3` / `session.v4` 閮借兘璇伙紱
4. 鎴柇鏂囦欢锛堟妸鏈€鍚?5 瀛楄妭鐮嶆帀锛夆啋 `scanFrames` 鎶?`trailing>0` / `decodeFrames` 鎶涢敊锛?5. 闈?zstd 鏂囦欢锛堥殢渚夸竴娈垫枃鏈級鈫?鎶涢敊锛岄敊璇爜鍙瘑鍒紱
6. `sessions.apply` 鍦ㄥす鍏蜂笂锛歚write:false` 鏃堕浂鏀瑰姩銆乣write:true` 鍚?`session-0001`/`session-0002` 鐨?cwd 琚敼鍐欙紝
   `session-0003`锛堟湰鏉ュ氨鍖归厤锛夎鍏?`unchanged`锛?*閲嶈窇涓€娆?= 0 鍙樻洿锛堝箓绛夛級**锛?7. 鏀瑰啓鍚?`verify` 鐨?`badFrames === 0` 涓?`mismatched.length === 0`銆?
## 3. 楠屾敹鍛戒护锛堜綘蹇呴』鑷繁璺戯紝骞舵妸杈撳嚭璐磋繘鎶ュ憡锛?
```powershell
cd D:\dshworkspace\dsh-migrate
node test/make-fixtures.mjs test\fixtures
node --test test\
node bin\dsh-migrate.mjs doctor -c test\fixtures\migrate.json   # 鑻ヨ鏂囦欢涓嶅瓨鍦紝鐢?test 閲屾瀯閫犵殑涓存椂閰嶇疆浠ｆ浛骞惰鏄?```

锛坄test/fixtures/` 琚?`.gitignore` 蹇界暐锛屽睘姝ｅ父銆傦級

## 4. 绾︽潫

- **闆朵緷璧?*锛氬彧鐢?`node:fs`銆乣node:zlib`銆乣node:path`銆乣node:crypto`銆乣node:test`銆乣node:assert`銆?- 涓嶈仈缃戙€佷笉瑁呭寘銆佷笉 `npm install`銆?- 涓嶆敼 `bin/`銆乣package.json`銆乣docs/`銆乣lib/util.mjs`銆乣lib/config.mjs`銆乣lib/manifest.mjs`銆乣test/make-fixtures.mjs`銆?- 涓嶅紩鍏?TypeScript銆佷笉寮曞叆 lint 閰嶇疆銆?- 浠ｇ爜娉ㄩ噴鐢ㄤ腑鏂囷紝绠€娲侊紱鍏抽敭澶勮鏄?涓轰粈涔?锛堝挨鍏跺抚鏍煎紡瑙ｆ瀽涓庨€愬瓧鑺傛柇瑷€锛夈€?- 鑻ユ煇鏉″疄鐜颁笌涓婇潰瑙勬牸鍐茬獊锛?*浠ヨ鏍间负鍑?*锛涜嫢瑙勬牸鏈韩鏈夎锛?*鍦ㄦ姤鍛婇噷鎸囧嚭骞剁粰鍑轰綘鐨勫鐞?*锛屼笉瑕侀潤榛樻敼鍙ｅ緞銆?
## 5. 鎶ュ憡鏍煎紡锛堝啓鍏?`D:\dsh-ref\.codex-tasks\report-p1-frames.md`锛?
```
# P1 鎶ュ憡
## 鐘舵€侊細DONE / PARTIAL / BLOCKED
## 鏀瑰姩鏂囦欢锛堥€愭潯锛氭枃浠?鈫?鍋氫簡浠€涔堬級
## 鍏抽敭瀹炵幇鐐癸紙甯цВ鏋愩€侀€愬瓧鑺傛柇瑷€銆佸箓绛夛級
## 璺戣繃鐨勫懡浠や笌鍘熷杈撳嚭锛堣创鍏抽敭琛岋級
## 涓庤鏍肩殑鍋忓樊锛堝鏈夛級
## 鏈畬鎴?椋庨櫓
```
