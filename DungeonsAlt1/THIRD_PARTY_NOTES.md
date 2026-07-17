# Third-party notes

The Alt1 map-anchor location approach in `src/alt1-map-locator.js` is adapted
from `Sleepy-meh-alt-1/dg-map` with author permission relayed by the project
maintainer via Discord.

The sprite-anchor Dungeoneering party reader in `src/party-anchor.js` is also
ported from `Sleepy-meh-alt-1/dg-map`: the `DG_ICON` / `DG_INTERFACE_ROW_END`
sprites, the five party-row colours, the 22px row geometry, and the background
removal. The bundled RuneScape chatbox OCR font at
`assets/fonts/chatbox/12pt.data.png` and its `OCR.loadFontImage` configuration
come from the same project.

Reference repository:
https://github.com/Sleepy-meh-alt-1/dg-map

## miseenplac/dghelper

The fast end-of-dungeon interface sentinel design (250 ms cadence, three RGB
zones, and the 5-of-25-pixels threshold per zone) is adapted from
`miseenplac/dghelper`, with permission from its owner, using commit
`80c9c6ced28c9a591d237749ef8c0ca06c6db615` as the reference version.

Reference repository:
https://github.com/miseenplac/dghelper

### MIT License

Copyright (c) 2026 miseenplac

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
