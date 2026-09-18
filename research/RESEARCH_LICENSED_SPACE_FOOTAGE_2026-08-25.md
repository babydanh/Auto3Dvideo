# Nghiên cứu footage vũ trụ có quyền — 2026-08-25

## Quyết định

Mẫu thử sẽ chỉ tải các clip có trang nguồn chính thức, domain được allowlist và license/usage condition được ghi vào provenance. Không dùng TikTok, Douyin, YouTube downloader, watermark removal hoặc clip có license không rõ. “Không bản quyền” được hiểu hẹp là public domain hoặc license cho phép dùng/biên tập theo điều kiện cụ thể; không phải mọi clip tìm thấy trên mạng đều được tự do dùng.

## Nguồn được chọn

| Source | Asset candidate | Điều kiện sử dụng | Cách ghi credit |
|---|---|---|---|
| NASA Scientific Visualization Studio | `HD Earth Views from Space`, ID 10766 | NASA SVS nêu nội dung của họ là public domain trừ khi có ghi khác; trang asset yêu cầu credit NASA. Với commercial use không được ngụ ý NASA bảo trợ; phải kiểm tra bên thứ ba, logo, người nhận diện và điều kiện riêng. | `NASA` và link trang asset |
| NASA Goddard Space Flight Center / CI Lab | `Big Bang Animation--5k Resolution`, ID 12656 | Trang asset nêu credit cụ thể NASA's Goddard Space Flight Center/CI Lab. Dùng đúng phạm vi media guideline NASA, không gắn logo/endorsement và không trình bày claim khoa học ngoài source review. | `NASA's Goddard Space Flight Center/CI Lab` và link trang asset |
| Wikimedia Commons | `Galaxy Collision Animation—James Webb Space Telescope Science` | File page ghi CC BY 3.0: được share/remix với attribution, link license và nêu thay đổi. Commons yêu cầu tự kiểm tra file page, author, license và hạn chế ngoài copyright trước khi dùng thương mại. | `James Webb Space Telescope (JWST)`/credit trên file page, CC BY 3.0, link file page và license |

## URL tải đã kiểm tra

- NASA Earth views page: `https://svs.gsfc.nasa.gov/10766/`
- NASA Earth views WebM family: `https://svs.gsfc.nasa.gov/vis/a010000/a010700/a010766/Earth_View_shuttle_over_clouds.webmhd.webm`
- NASA Big Bang page: `https://svs.gsfc.nasa.gov/12656/`
- NASA Big Bang WebM: `https://svs.gsfc.nasa.gov/vis/a010000/a012600/a012656/12656_Big_Bang_1080.webm`
- Wikimedia Commons file page: `https://commons.wikimedia.org/wiki/File:Galaxy_Collision_Animation-_James_Webb_Space_Telescope_Science.webm`
- Wikimedia Commons file endpoint: `https://commons.wikimedia.org/wiki/Special:FilePath/Galaxy_Collision_Animation-_James_Webb_Space_Telescope_Science.webm`

## Policy interpretation

NASA content generally may be used for educational/informational purposes under its media guidelines, but NASA logos, identifiers, third-party material, identifiable people and endorsement implications need separate review. Creative Commons terms control the exact derivative/commercial permission: CC BY permits adaptation and commercial use with attribution; ND disallows adaptations; NC disallows commercial use; SA requires compatible share-alike licensing. Wikimedia’s file page is the source of truth for each individual asset, and its licensing metadata is not a warranty.

## Collector requirements

The collector must accept only a bounded manifest, validate HTTPS, exact hostname allowlist, content-length/max-byte limit, timeout, extension/content signature, optional expected SHA-256, and provenance fields. Each downloaded asset gets source URL, landing page, author/credit, license, retrieval timestamp, modification note, hash and review state. Asset import must stop when license is missing, `NC` is used for a monetized target, `ND` is used with transformations, or attribution data is incomplete.

## References

[1]: https://www.nasa.gov/nasa-brand-center/images-and-media/ "NASA Images and Media Usage Guidelines"
[2]: https://svs.gsfc.nasa.gov/ "NASA Scientific Visualization Studio"
[3]: https://svs.gsfc.nasa.gov/10766/ "NASA HD Earth Views from Space"
[4]: https://svs.gsfc.nasa.gov/12656/ "NASA Big Bang Animation--5k Resolution"
[5]: https://creativecommons.org/cc-licenses/ "Creative Commons license types"
[6]: https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia "Wikimedia Commons reuse guidance"
[7]: https://commons.wikimedia.org/wiki/File:Galaxy_Collision_Animation-_James_Webb_Space_Telescope_Science.webm "Wikimedia Commons Galaxy Collision file page"
