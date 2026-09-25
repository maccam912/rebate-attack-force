// Reproducible terrain artwork. Ordinary compilation never overwrites edited PNGs.
import { chromium } from "playwright";
import { existsSync, writeFileSync } from "node:fs";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined) });
try {
  const page = await browser.newPage();
  for (const id of ["mossback-grotto", "amber-arches", "mooncap-garden"]) {
    const png = await page.evaluate((id) => {
      const forest = id === "mossback-grotto", mountain = id === "amber-arches";
      const width = forest ? 3200 : mountain ? 3600 : 2600;
      const height = forest ? 1850 : mountain ? 2000 : 2200;
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const c = canvas.getContext("2d");
      function fill(d, color) { c.fillStyle = color; c.fill(new Path2D(d)); }
      function stroke(d, color, w) {
        c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = color; c.lineWidth = w;
        c.stroke(new Path2D(d));
      }
      function ellipse(x, y, rx, ry, color) {
        c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
      }
      function gradient(top, bottom) {
        const g = c.createLinearGradient(0, 0, 0, height); g.addColorStop(0, top); g.addColorStop(1, bottom); return g;
      }
      // The complete painted backdrop lives in the PNG. Alpha is capped AFTER
      // compositing, so foliage and distant mountains never become solid.
      c.fillStyle = forest ? gradient("#b7c797", "#647f63") : mountain
        ? gradient("#a2bbcd", "#edd4b0") : gradient("#526879", "#142c3b");
      c.fillRect(0, 0, width, height);
      if (forest) {
        ellipse(2250, 270, 140, 140, "#f4e9b2");
        for (let i = 0; i < 14; i++) {
          const x = i * 270 - 130;
          stroke(`M ${x} 1900 Q ${x + 140} 900 ${x + 60} 100`, "#456b6550", 50 + i % 3 * 22);
          for (let j = 0; j < 4; j++) {
            const y = 170 + j * 285 + i % 3 * 50;
            stroke(`M ${x + 65} ${y + 130} Q ${x - 100} ${y + 45} ${x - 190} ${y - 40}`, "#456b6540", 22);
          }
        }
        // Leaves are porous scenery, with open branch silhouettes drawn over them.
        for (const [x, y, rx, ry] of [[300,420,320,190],[850,330,450,210],[1150,700,310,130],
          [1660,450,290,220],[2050,690,300,175],[2440,280,300,190],[2920,410,300,230]]) {
          for (let i = 0; i < 38; i++) {
            const angle = i * 2.39996, f = Math.sqrt((i + .5) / 38);
            ellipse(x + Math.cos(angle) * rx * f, y + Math.sin(angle) * ry * f,
              55 + i % 5 * 9, 36 + i % 4 * 9, ["#426d5650", "#73975770", "#a8bb6770"][i % 3]);
          }
        }
        for (let i = 0; i < 5; i++) fill(`M ${600+i*500} 0 L ${770+i*500} 0 L ${150+i*530} 1850 L ${-100+i*530} 1850 Z`, "#fff5c018");
      } else if (mountain) {
        for (let layer = 0; layer < 3; layer++) {
          let d = `M 0 ${1500 + layer * 100}`;
          for (let x = 0; x <= width + 300; x += 220) d += ` L ${x} ${550 + ((x * 13 + layer * 247) % 740) + layer * 120}`;
          fill(d + ` L ${width} 2000 L 0 2000 Z`, ["#7290a15e", "#71899880", "#83939270"][layer]);
        }
        for (let i = 0; i < 12; i++) stroke(`M ${i*340-100} ${110+i%3*85} q 80 -20 240 0`, "#f6f2de80", 16);
      } else {
        ellipse(1340, 200, 120, 120, "#d4d7b380");
        ellipse(1370, 180, 110, 110, "#526879");
        for (let i = 0; i < 20; i++) {
          const x = (i * 431) % width;
          stroke(`M ${x} 550 Q ${x - 180} 1400 ${x + 30} 2200`, "#0c273348", 35 + i % 4 * 20);
        }
        for (let i = 0; i < 130; i++) ellipse((i * 193) % width, (i * 137) % height, 1.5 + i % 2, 2, "#bce4d050");
      }
      const backdrop = c.getImageData(0, 0, width, height);
      for (let i = 3; i < backdrop.data.length; i += 4) backdrop.data[i] = 230;
      c.putImageData(backdrop, 0, 0);

      function rock(d, colors, seed = 0) {
        const path = new Path2D(d);
        c.save(); c.clip(path);
        c.fillStyle = gradient(colors[0], colors[1]); c.fillRect(0, 0, width, height);
        for (let i = 0; i < 40; i++) {
          const y = i * 65 + seed * 9;
          stroke(`M -50 ${y} Q ${width*.3} ${y-90} ${width*.58} ${y+30} T ${width+50} ${y-40}`, colors[2] + "36", 2 + i % 3);
        }
        for (let i = 0; i < 1500; i++) ellipse((i*433+seed*71)%width, (i*197+seed*89)%height,
          1+i%4, 1+i%2, i%3 ? "#f7ecc31a" : "#101d3224");
        stroke(d, colors[1], 15); stroke(d, colors[2], 6);
        c.restore();
      }
      function limb(d, w, moss = true) {
        stroke(d, "#293e38", w + 7);
        stroke(d, "#776c48", w);
        stroke(d, "#968456", w * .55);
        stroke(d, "#bea26c", Math.max(2, w * .11));
        if (moss) {
          c.save(); c.translate(-2, -w * .18);
          stroke(d, "#63894f", Math.max(4, w * .23)); c.restore();
        }
      }
      if (forest) {
        rock("M 0 1625 Q 160 1560 310 1620 Q 560 1745 830 1650 Q 1090 1530 1370 1670 Q 1580 1770 1850 1680 Q 2110 1550 2400 1640 Q 2700 1740 2920 1590 Q 3060 1550 3200 1600 L 3200 1850 L 0 1850 Z", ["#84935a", "#3a5141", "#c1c579"], 1);
        // Solid trunks, spreading roots and overlapping forks. No leaf-canopy platforms.
        limb("M 440 1670 Q 590 1530 590 1340 Q 535 1150 605 975 Q 660 830 583 680 Q 555 475 670 260", 125);
        limb("M 575 1450 Q 440 1600 260 1620", 57); limb("M 580 1470 Q 740 1580 820 1650", 60);
        limb("M 594 990 Q 400 977 294 826 Q 231 723 107 705", 72);
        limb("M 590 1200 Q 790 1180 903 1070 Q 997 988 1130 958", 60);
        limb("M 597 723 Q 457 630 364 493 Q 280 409 153 451", 59);
        limb("M 617 520 Q 837 499 1002 363 Q 1070 306 1108 198", 47);
        limb("M 902 1070 Q 884 896 799 846", 29);
        limb("M 392 859 Q 500 782 471 655", 29);
        limb("M 361 489 Q 402 381 360 292", 23);
        limb("M 1000 362 Q 1155 398 1250 302", 24);
        limb("M 905 433 Q 921 292 860 245", 22);
        limb("M 1610 1720 Q 1493 1510 1580 1260 Q 1656 1070 1550 959 Q 1510 799 1690 624 Q 1760 504 1660 413", 116);
        limb("M 1550 1570 Q 1415 1660 1280 1650", 63); limb("M 1550 1550 Q 1740 1590 1850 1680", 49);
        limb("M 1584 1250 Q 1390 1261 1265 1140 Q 1152 1061 1090 1030", 55);
        limb("M 1585 980 Q 1870 1020 2025 887 Q 2140 800 2180 664", 64);
        limb("M 1670 656 Q 1480 740 1340 701 Q 1190 674 1160 589", 43);
        limb("M 1760 993 Q 1767 801 1900 746", 31);
        limb("M 2040 862 Q 1900 744 1962 600", 26);
        limb("M 1270 1140 Q 1300 1000 1230 927", 22);
        limb("M 2700 1670 Q 2580 1500 2630 1290 Q 2670 1150 2530 1010 Q 2460 800 2560 632 Q 2630 480 2580 282", 137);
        limb("M 2650 1510 Q 2460 1555 2360 1640", 60); limb("M 2650 1510 Q 2820 1665 2980 1590", 57);
        limb("M 2625 1250 Q 2850 1310 3010 1140 Q 3100 1050 3100 922", 66);
        limb("M 2540 790 Q 2300 743 2238 540 Q 2180 465 2110 442", 62);
        limb("M 2600 526 Q 2790 567 2900 410 Q 2940 339 3060 320", 48);
        limb("M 2840 1270 Q 2900 1070 2795 980", 31);
        limb("M 2250 555 Q 2340 432 2290 306", 25);
        limb("M 2890 425 Q 2830 313 2798 226", 23);
        // Moss and shelf fungi grow from bark without becoming broad level crowns.
        for (const [x,y] of [[607,1050],[1587,1360],[2540,903],[2620,1460],[566,1340]]) {
          fill(`M ${x-42} ${y} Q ${x-73} ${y-20} ${x-20} ${y-29} Q ${x+4} ${y-9} ${x-42} ${y} Z`, "#cfa576");
        }
      } else if (mountain) {
        // Jagged connected mountain silhouettes: long sloping faces, knife-edge
        // summits, small notches and flooded clefts. Nothing floats in rows.
        const west = "M 0 1450 Q 120 1390 235 1430 Q 390 1510 475 1390 L 650 1020 L 730 1130 L 965 400 L 1040 875 L 1130 745 L 1340 1430 Q 1400 1510 1430 1690 L 1490 2000 L 0 2000 Z";
        const middle = "M 1520 2000 L 1510 1730 L 1630 1570 L 1720 990 L 1825 1160 L 1990 195 L 2110 835 L 2210 705 L 2400 1490 Q 2450 1590 2530 1620 L 2500 2000 Z";
        const east = "M 2590 2000 L 2600 1670 L 2680 1390 L 2800 875 L 2890 1040 L 3050 490 L 3135 1170 L 3230 1420 Q 3390 1510 3600 1410 L 3600 2000 Z";
        for (const [i,d] of [west,middle,east].entries()) {
          rock(d, ["#9aabb0", "#3c4756", "#d5cdb5"], i);
          c.save(); c.clip(new Path2D(d));
          for (let j = 0; j < 18; j++) {
            const x = i*1300 + j*81;
            fill(`M ${x} 200 L ${x+240} 2000 L ${x-110} 2000 Z`, j%2 ? "#d1dce321" : "#182e4035");
          }
          c.restore();
        }
        c.save(); c.clip(new Path2D(west));
        fill("M 860 360 L 1080 350 L 1070 1040 L 1013 766 L 990 827 L 956 671 L 885 775 Z", "#e5e8dc"); c.restore();
        c.save(); c.clip(new Path2D(middle));
        fill("M 1890 160 L 2110 140 L 2160 977 L 2085 753 L 2040 807 L 1989 556 L 1920 729 Z", "#eef0e3"); c.restore();
        c.save(); c.clip(new Path2D(east));
        fill("M 2920 410 L 3170 400 L 3140 1170 L 3090 947 L 3055 955 L 3020 801 L 2950 882 Z", "#e1e6de"); c.restore();
        // A weathered leaning pine in the western refuge gives a useful grapple.
        limb("M 180 1420 Q 220 1230 153 1120", 32, false);
        limb("M 201 1280 L 109 1230", 14, false); limb("M 198 1240 L 262 1158", 13, false);
        limb("M 3480 1440 Q 3410 1320 3450 1225", 27, false);
      } else {
        const left = "M 0 665 Q 110 590 250 655 Q 410 720 550 657 Q 715 665 837 864 Q 710 998 808 1100 Q 920 1180 811 1350 Q 650 1480 910 1580 Q 1040 1700 915 1850 L 1030 2200 L 0 2200 Z";
        const right = "M 1840 2200 Q 1900 1940 1740 1840 Q 1600 1730 1830 1530 Q 2000 1410 1805 1260 Q 1710 1175 1940 1030 Q 2060 900 1930 753 Q 1920 580 2110 489 Q 2340 580 2600 455 L 2600 2200 Z";
        rock(left, ["#8ca3a0", "#28384c", "#b4c5b1"], 3);
        rock(right, ["#8ca3a0", "#28384c", "#b4c5b1"], 5);
        // Side-wall teeth, real overhangs and narrow pockets, not isolated shelves.
        rock("M 748 1000 Q 920 1020 1040 890 L 920 1190 L 800 1240 Z", ["#849da0", "#2d4050", "#afc4b1"], 2);
        rock("M 1930 1030 L 1760 1120 L 1620 1050 L 1730 1310 L 1860 1390 Z", ["#809699", "#2d4050", "#afc4b1"], 3);
        rock("M 900 1740 L 1180 1880 L 1110 2030 L 980 1990 Z", ["#809699", "#2d4050", "#afc4b1"], 4);
        // A sagging root makes one continuous, exposed route across the void.
        limb("M 580 673 Q 720 970 927 1190 Q 1180 1440 1430 1260 Q 1650 1120 1920 1050", 35, false);
        limb("M 785 980 Q 960 895 1130 967 Q 1210 1020 1280 1001", 27, false);
        limb("M 1660 1130 Q 1530 960 1560 815", 23, false);
        limb("M 2200 515 Q 2070 698 2140 830 Q 2280 1020 2080 1270", 51, false);
        // Broken, hanging ends cannot be walked across; ropes/jumps are necessary.
        limb("M 810 1440 Q 1020 1510 1180 1620", 22, false);
        limb("M 1740 1710 Q 1560 1590 1415 1640", 24, false);
        limb("M 380 662 Q 410 450 355 335", 61, false);
        limb("M 390 475 Q 245 430 195 310", 29, false);
        limb("M 380 420 Q 505 390 565 270", 24, false);
        limb("M 2350 522 Q 2400 347 2305 257", 58, false);
        limb("M 2372 375 Q 2210 399 2130 280", 26, false);
        limb("M 2370 337 Q 2470 277 2490 190", 23, false);
      }
      return canvas.toDataURL("image/png").split(",")[1];
    }, id);
    writeFileSync(new URL(`../public/maps/${id}.png`, import.meta.url), Buffer.from(png, "base64"));
    console.log(`Painted ${id}.png`);
  }
} finally { await browser.close(); }
