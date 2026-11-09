/* ---------- Ernährungstagebuch: Lebensmittel erfassen (Grundliste, Open Food Facts, Barcode, eigene) ----------
   data.foodLog = [{ id, date, meal: 'b'|'l'|'d'|'s', key, name, brand, g, per: [kcal, Eiweiß, Kohlenhydrate, Fett, Ballaststoffe, Zucker] je 100 g }]
   (Ballaststoffe/Zucker freiwillig: fehlen oder null = unbekannt, z. B. ältere Einträge – Anzeige ohne Tagesziel)
   (Nährwerte werden pro Eintrag mitgespeichert – spätere Änderungen am Lebensmittel ändern alte Tage nicht).
   data.foods = { key: Lebensmittel } – gemerkte Lebensmittel (zuletzt gegessen, Favoriten, eigene, aus Open Food Facts);
   bei Lebensmitteln der Grundliste nur { fav, last }.
   Die Tagessumme landet als data.intake-Eintrag mit src 'food' (Ist ↔ Soll, 14 Tage, gemessener Bedarf).
   data.foodClosed = { Datum: true } – abgeschlossene Tage (nur sie zählen für den gemessenen Bedarf);
   „Rest auffüllen“ legt einen Eintrag mit key 'fill' (meal 'f') an.
   data.foodMeals = [{ id, name, items: [{ key, name, brand, g, per }] }] – gespeicherte Mahlzeiten (Schnellauswahl). */

// Grundliste: [Name, kcal, Eiweiß, Kohlenhydrate, Fett] je 100 g, optional [Portion, Gramm]. Durchschnittswerte.
const FOOD_BASE = [
  // Getreide, Beilagen
  ['Haferflocken', 370, 13.5, 59, 7, '1 Portion', 50],
  ['Reis, roh', 350, 7, 78, 0.6, '1 Portion (roh)', 75],
  ['Reis, gekocht', 130, 2.7, 28, 0.3, '1 Portion', 200],
  ['Vollkornreis, roh', 350, 7.5, 74, 2.5, '1 Portion (roh)', 75],
  ['Nudeln, roh', 355, 12.5, 70, 1.5, '1 Portion (roh)', 100],
  ['Nudeln, gekocht', 150, 5.5, 30, 0.8, '1 Portion', 250],
  ['Vollkornnudeln, roh', 345, 13.5, 64, 2.5, '1 Portion (roh)', 100],
  ['Kartoffeln, gekocht', 72, 2, 15, 0.1, '1 Kartoffel', 80],
  ['Süßkartoffel', 86, 1.6, 20, 0.1, '1 Süßkartoffel', 200],
  ['Pommes frites, zubereitet', 290, 3.5, 36, 14, '1 Portion', 150],
  ['Bratkartoffeln', 150, 2.5, 20, 6.5, '1 Portion', 200],
  ['Kartoffelpüree, mit Milch', 90, 2, 13, 3.5, '1 Portion', 200],
  ['Couscous, roh', 360, 12, 72, 1.5, '1 Portion (roh)', 75],
  ['Bulgur, roh', 350, 12, 70, 1.5, '1 Portion (roh)', 75],
  ['Quinoa, roh', 368, 14, 64, 6, '1 Portion (roh)', 75],
  ['Hirse, roh', 360, 10.5, 69, 4, '1 Portion (roh)', 75],
  ['Grieß, roh', 330, 10, 69, 0.8],
  ['Weizenmehl', 340, 10, 72, 1],
  ['Cornflakes', 375, 7.5, 84, 0.9, '1 Portion', 30],
  ['Müsli, ohne Zuckerzusatz', 360, 10, 60, 7, '1 Portion', 50],
  ['Knuspermüsli (Crunchy)', 450, 8, 63, 17, '1 Portion', 50],
  ['Reiswaffel', 385, 8, 81, 3, '1 Reiswaffel', 8],
  ['Knäckebrot', 340, 10, 66, 1.5, '1 Scheibe', 10],
  // Brot, Backwaren
  ['Vollkornbrot', 215, 7, 38, 1.2, '1 Scheibe', 50],
  ['Mischbrot', 230, 6.5, 45, 1.3, '1 Scheibe', 45],
  ['Toastbrot (Weizen)', 260, 8, 47, 3.5, '1 Scheibe', 25],
  ['Vollkorntoast', 250, 9, 42, 4.5, '1 Scheibe', 25],
  ['Brötchen (Weizen)', 270, 9, 53, 1.5, '1 Brötchen', 55],
  ['Vollkornbrötchen', 245, 9.5, 42, 3, '1 Brötchen', 60],
  ['Laugenbrezel', 270, 8.5, 54, 2, '1 Brezel', 85],
  ['Croissant', 410, 8, 45, 21, '1 Croissant', 60],
  ['Baguette', 260, 8.5, 53, 1.3, '1 Stück', 50],
  ['Wrap (Weizentortilla)', 310, 8.5, 52, 7.5, '1 Wrap', 60],
  ['Fladenbrot', 270, 9, 55, 1.2, '1 Viertel', 100],
  ['Pfannkuchen', 215, 7, 26, 9, '1 Pfannkuchen', 80],
  // Milch und Milchprodukte
  ['Milch 3,5 %', 64, 3.3, 4.8, 3.5, '1 Glas (200 ml)', 200],
  ['Milch 1,5 %', 47, 3.4, 4.9, 1.5, '1 Glas (200 ml)', 200],
  ['Haferdrink', 45, 1, 6.5, 1.5, '1 Glas (200 ml)', 200],
  ['Sojadrink, ungesüßt', 39, 3, 2.5, 1.8, '1 Glas (200 ml)', 200],
  ['Magerquark', 67, 12, 4, 0.3, '1 Becher', 250],
  ['Speisequark 20 %', 110, 12, 3.5, 5, '1 Becher', 250],
  ['Speisequark 40 %', 160, 11, 3, 11.5, '1 Becher', 250],
  ['Skyr natur', 63, 11, 4, 0.2, '1 Becher', 150],
  ['Joghurt natur 3,5 %', 66, 3.8, 4.5, 3.5, '1 Becher', 150],
  ['Joghurt natur 1,5 %', 47, 4, 4.5, 1.5, '1 Becher', 150],
  ['Griechischer Joghurt 10 %', 125, 4, 4, 10, '1 Portion', 150],
  ['Fruchtjoghurt', 95, 3.5, 14, 2.8, '1 Becher', 150],
  ['Hüttenkäse (körniger Frischkäse)', 100, 12.5, 2, 4.5, '1 Becher', 200],
  ['Frischkäse natur (Doppelrahm)', 230, 5.5, 3.5, 21.5, '1 Portion', 30],
  ['Frischkäse leicht', 150, 8, 4, 11, '1 Portion', 30],
  ['Gouda', 356, 25, 0, 28, '1 Scheibe', 25],
  ['Emmentaler', 380, 28.5, 0, 29.5, '1 Scheibe', 25],
  ['Mozzarella', 250, 18, 1, 19.5, '1 Kugel', 125],
  ['Mozzarella light', 165, 19, 1, 9.5, '1 Kugel', 125],
  ['Feta (Schafskäse)', 265, 17, 0.5, 21.5, '1 Portion', 50],
  ['Parmesan', 395, 33, 0, 29, '1 EL gerieben', 10],
  ['Harzer Käse', 125, 27, 0, 0.7, '1 Stück', 30],
  ['Butter', 741, 0.7, 0.6, 83, '1 TL', 5],
  ['Schlagsahne 30 %', 292, 2.4, 3.2, 30, '1 EL', 15],
  ['Saure Sahne 10 %', 117, 3, 4, 10, '1 EL', 15],
  ['Schmand 24 %', 240, 2.5, 3.5, 24, '1 EL', 15],
  ['Crème fraîche', 300, 2.4, 2.6, 30, '1 EL', 15],
  ['Proteinpudding', 75, 10, 6, 1.5, '1 Becher', 200],
  ['Pudding (Schoko), fertig', 110, 3, 17, 3.2, '1 Becher', 125],
  // Eier
  ['Ei', 143, 12.6, 0.7, 9.5, '1 Ei (M)', 55],
  ['Eiklar', 48, 11, 0.7, 0.2, '1 Eiklar', 33],
  ['Spiegelei, in Fett gebraten', 190, 13.5, 0.7, 15, '1 Spiegelei', 60],
  // Fleisch, Wurst
  ['Hähnchenbrust, roh', 106, 23.5, 0, 1.2, '1 Portion', 150],
  ['Hähnchenbrust, gebraten', 155, 30, 0, 3.6, '1 Portion', 120],
  ['Putenbrust, roh', 105, 24, 0, 1, '1 Portion', 150],
  ['Hähnchenschenkel mit Haut, roh', 190, 18, 0, 13, '1 Schenkel', 200],
  ['Rinderhackfleisch (20 % Fett), roh', 254, 17, 0, 20, '1 Portion', 125],
  ['Rinderhackfleisch mager (5 % Fett), roh', 137, 21, 0, 5, '1 Portion', 125],
  ['Hackfleisch gemischt, roh', 260, 18, 0, 21, '1 Portion', 125],
  ['Rindersteak (Hüfte, Rumpsteak), roh', 135, 22, 0, 5, '1 Steak', 200],
  ['Schweinefilet, roh', 112, 21, 0, 3, '1 Portion', 150],
  ['Schweineschnitzel, roh', 106, 22, 0, 2, '1 Schnitzel', 150],
  ['Schweinenacken, roh', 200, 18, 0, 14.5, '1 Scheibe', 150],
  ['Kasseler', 140, 21, 0.5, 6, '1 Scheibe', 150],
  ['Schnitzel paniert, gebraten', 230, 18, 12, 12, '1 Schnitzel', 180],
  ['Frikadelle', 240, 15, 8, 16, '1 Frikadelle', 80],
  ['Gyros (Fleisch)', 220, 20, 1, 15, '1 Portion', 200],
  ['Rindergulasch', 120, 15, 3, 5, '1 Portion', 250],
  ['Frühstücksspeck (Bacon)', 330, 16, 0.5, 30, '1 Scheibe', 10],
  ['Kochschinken', 110, 19, 1, 3, '1 Scheibe', 20],
  ['Putenbrust-Aufschnitt', 105, 22, 1, 1.5, '1 Scheibe', 15],
  ['Salami', 400, 22, 0.5, 34, '1 Scheibe', 10],
  ['Leberwurst', 300, 14, 1.5, 26.5, '1 Portion', 20],
  ['Fleischwurst (Lyoner)', 270, 12, 0.5, 24.5, '1 Scheibe', 20],
  ['Wiener Würstchen', 270, 13, 0.5, 24, '1 Würstchen', 50],
  ['Bratwurst', 290, 14, 0.5, 25.5, '1 Bratwurst', 100],
  ['Leberkäse', 290, 12, 0.5, 26, '1 Scheibe', 100],
  ['Currywurst mit Soße', 230, 10, 8, 17.5, '1 Portion', 250],
  ['Döner Kebab im Brot', 215, 11, 20, 10, '1 Döner', 350],
  // Fisch
  ['Lachs, roh', 200, 20, 0, 13, '1 Filet', 125],
  ['Thunfisch im eigenen Saft (abgetropft)', 110, 25, 0, 1, '1 Dose (abgetropft)', 120],
  ['Thunfisch in Öl (abgetropft)', 200, 24, 0, 11, '1 Dose (abgetropft)', 120],
  ['Seelachs, roh', 80, 18, 0, 0.9, '1 Filet', 125],
  ['Kabeljau, roh', 78, 18, 0, 0.7, '1 Filet', 125],
  ['Garnelen, roh', 75, 17, 0.5, 0.8, '1 Portion', 100],
  ['Fischstäbchen', 200, 13, 18, 8.5, '1 Fischstäbchen', 30],
  ['Matjesfilet', 255, 16, 0, 21.5, '1 Filet', 50],
  ['Makrele, geräuchert', 290, 19, 0, 24, '1 Filet', 100],
  ['Sushi (Maki)', 150, 4.5, 28, 2, '1 Stück', 25],
  // Hülsenfrüchte, Soja, Nüsse
  ['Linsen, roh', 320, 24, 48, 1.5, '1 Portion (roh)', 70],
  ['Linsen, gekocht', 115, 9, 16, 0.5, '1 Portion', 200],
  ['Kichererbsen (Dose, abgetropft)', 120, 7, 15, 2.5, '1 Dose (abgetropft)', 240],
  ['Kidneybohnen (Dose, abgetropft)', 100, 7, 14, 0.5, '1 Dose (abgetropft)', 250],
  ['Weiße Bohnen (Dose, abgetropft)', 95, 6.5, 13, 0.5, '1 Dose (abgetropft)', 250],
  ['Erbsen (TK)', 80, 5.4, 10, 0.4, '1 Portion', 150],
  ['Edamame (TK)', 125, 11.5, 5, 5.5, '1 Portion', 100],
  ['Tofu natur', 125, 13, 1.5, 7.5, '1 Packung', 200],
  ['Räuchertofu', 160, 16, 2, 10, '1 Packung', 200],
  ['Sojaschnetzel, trocken', 330, 50, 17, 1.5, '1 Portion (trocken)', 50],
  ['Falafel', 330, 13, 28, 18, '1 Falafel', 20],
  ['Hummus', 280, 7, 12, 22, '1 EL', 20],
  ['Erdnussbutter', 610, 25, 11, 50, '1 EL', 15],
  ['Erdnüsse, geröstet', 610, 25, 11, 50, '1 Handvoll', 25],
  ['Mandeln', 600, 21, 5.5, 53, '1 Handvoll', 25],
  ['Walnüsse', 690, 15, 7, 65, '1 Handvoll', 25],
  ['Haselnüsse', 650, 15, 10.5, 61, '1 Handvoll', 25],
  ['Cashewkerne', 580, 18, 30, 44, '1 Handvoll', 25],
  ['Pistazien', 585, 20, 17, 46, '1 Handvoll', 25],
  ['Nussmischung (Studentenfutter)', 470, 13, 40, 29, '1 Handvoll', 30],
  ['Chiasamen', 470, 21, 4, 31, '1 EL', 12],
  ['Leinsamen', 500, 24, 2, 37, '1 EL', 10],
  ['Sonnenblumenkerne', 600, 22, 12, 50, '1 EL', 10],
  ['Kürbiskerne', 580, 30, 5, 49, '1 EL', 10],
  ['Kokosraspeln', 660, 6.5, 6.5, 63, '1 EL', 7],
  // Obst
  ['Apfel', 54, 0.3, 11.4, 0.2, '1 Apfel', 150],
  ['Banane', 90, 1.1, 20, 0.2, '1 Banane (geschält)', 120],
  ['Birne', 57, 0.4, 12.4, 0.1, '1 Birne', 150],
  ['Orange', 47, 1, 9, 0.2, '1 Orange (geschält)', 150],
  ['Mandarine, Clementine', 50, 0.7, 10, 0.3, '1 Stück (geschält)', 70],
  ['Kiwi', 59, 1, 11, 0.6, '1 Kiwi', 75],
  ['Erdbeeren', 32, 0.7, 5.5, 0.4, '1 Schälchen', 150],
  ['Heidelbeeren', 42, 0.6, 7.4, 0.6, '1 Schälchen', 125],
  ['Himbeeren', 38, 1.3, 4.8, 0.3, '1 Schälchen', 125],
  ['Weintrauben', 70, 0.7, 16, 0.2, '1 Portion', 125],
  ['Ananas', 55, 0.5, 12, 0.2, '1 Portion', 150],
  ['Mango', 62, 0.6, 13, 0.4, '½ Mango', 150],
  ['Wassermelone', 30, 0.6, 7, 0.2, '1 Stück', 250],
  ['Pfirsich, Nektarine', 42, 0.8, 9, 0.1, '1 Stück', 130],
  ['Kirschen', 63, 1, 13.3, 0.3, '1 Portion', 125],
  ['Pflaumen', 47, 0.6, 10.2, 0.2, '1 Pflaume', 35],
  ['Avocado', 165, 2, 1.9, 15.4, '½ Avocado', 70],
  ['Apfelmus, ungesüßt', 60, 0.3, 13.5, 0.1, '1 Portion', 100],
  ['Rosinen', 294, 2.5, 68, 0.5, '1 EL', 15],
  ['Datteln, getrocknet', 280, 2, 65, 0.5, '1 Dattel', 8],
  // Gemüse
  ['Brokkoli', 35, 3, 4, 0.4, '1 Portion', 200],
  ['Blumenkohl', 25, 2, 2.5, 0.3, '1 Portion', 200],
  ['Paprika', 31, 1, 5, 0.3, '1 Paprika', 150],
  ['Tomate', 18, 0.9, 2.6, 0.2, '1 Tomate', 100],
  ['Gurke', 12, 0.6, 1.8, 0.1, '1 Portion', 100],
  ['Karotte (Möhre)', 38, 0.9, 6.8, 0.2, '1 Karotte', 70],
  ['Zucchini', 17, 1.2, 2.2, 0.3, '1 Zucchini', 250],
  ['Aubergine', 22, 1.2, 2.5, 0.2, '1 Aubergine', 300],
  ['Spinat', 24, 2.9, 1.6, 0.4, '1 Portion', 150],
  ['Blattsalat (Kopfsalat, Eisberg, Feldsalat)', 14, 1, 1.6, 0.2, '1 Portion', 50],
  ['Rucola', 25, 2.6, 2, 0.7, '1 Portion', 30],
  ['Zwiebel', 40, 1.1, 7.6, 0.1, '1 Zwiebel', 80],
  ['Champignons', 22, 3, 2.3, 0.3, '1 Portion', 150],
  ['Mais (Dose, abgetropft)', 85, 2.9, 15, 1.2, '1 Dose (abgetropft)', 140],
  ['Grüne Bohnen', 30, 1.8, 4.5, 0.2, '1 Portion', 150],
  ['Kohlrabi', 25, 1.9, 3.7, 0.1, '1 Kohlrabi', 250],
  ['Rosenkohl', 43, 3.4, 5.2, 0.3, '1 Portion', 150],
  ['Weißkohl, Rotkohl', 27, 1.4, 4.2, 0.2, '1 Portion', 150],
  ['Sauerkraut', 20, 1.4, 2, 0.2, '1 Portion', 150],
  ['Spargel', 20, 2, 2, 0.2, '1 Portion', 250],
  ['Rote Bete, gekocht', 44, 1.7, 8.5, 0.2, '1 Knolle', 100],
  ['Kürbis (Hokkaido)', 45, 1.7, 8, 0.6, '1 Portion', 200],
  ['Gemüsemischung (TK)', 35, 2, 5, 0.4, '1 Portion', 200],
  ['Oliven', 145, 1.3, 1, 15, '5 Oliven', 20],
  ['Gewürzgurken', 20, 0.5, 3.5, 0.1, '1 Gurke', 30],
  // Fette, Soßen, Aufstriche
  ['Speiseöl (Olivenöl, Rapsöl, Sonnenblumenöl)', 884, 0, 0, 100, '1 EL', 10],
  ['Margarine', 720, 0.2, 0.5, 80, '1 TL', 5],
  ['Mayonnaise', 700, 1.1, 2, 76, '1 EL', 15],
  ['Ketchup', 102, 1.2, 23, 0.1, '1 EL', 15],
  ['Senf', 85, 5.5, 5, 4.5, '1 TL', 5],
  ['Pesto (Basilikum)', 480, 5, 6, 48, '1 EL', 15],
  ['Passierte Tomaten (Passata)', 33, 1.5, 5, 0.2, '1 Portion', 100],
  ['Tomatensoße, fertig', 60, 1.5, 7.5, 2.5, '1 Portion', 125],
  ['Sojasoße', 70, 10, 6, 0, '1 EL', 15],
  ['Balsamico-Essig', 100, 0.5, 20, 0, '1 EL', 15],
  ['Honig', 310, 0.4, 76, 0, '1 TL', 10],
  ['Marmelade, Konfitüre', 250, 0.4, 60, 0.1, '1 Portion', 20],
  ['Nuss-Nougat-Creme', 540, 6.3, 57.5, 31, '1 Portion', 15],
  ['Zucker', 400, 0, 100, 0, '1 TL', 5],
  ['Ahornsirup', 260, 0, 67, 0.1, '1 EL', 20],
  // Süßes, Snacks
  ['Vollmilchschokolade', 535, 7.5, 56, 30, '1 Reihe', 25],
  ['Zartbitterschokolade 70 %', 570, 9, 33, 43, '1 Reihe', 25],
  ['Gummibärchen', 343, 6.9, 77, 0.5, '1 Handvoll', 25],
  ['Butterkekse', 440, 7.5, 72, 13, '1 Keks', 8],
  ['Kartoffelchips', 530, 6, 50, 33, '1 Handvoll', 30],
  ['Salzstangen', 380, 10, 77, 3.5, '1 Handvoll', 30],
  ['Vanilleeis', 200, 3.5, 24, 10, '1 Kugel', 60],
  ['Rührkuchen, Marmorkuchen', 380, 5.5, 48, 18, '1 Stück', 70],
  ['Käsekuchen', 235, 7, 27, 11, '1 Stück', 120],
  ['Müsliriegel', 410, 6, 64, 13, '1 Riegel', 25],
  ['Proteinriegel', 360, 32, 30, 12, '1 Riegel', 55],
  // Getränke
  ['Orangensaft', 45, 0.7, 9.5, 0.2, '1 Glas (200 ml)', 200],
  ['Apfelsaft', 46, 0.1, 11, 0.1, '1 Glas (200 ml)', 200],
  ['Apfelschorle', 23, 0.1, 5.5, 0, '1 Glas (250 ml)', 250],
  ['Cola', 42, 0, 10.6, 0, '1 Dose (330 ml)', 330],
  ['Cola zero, Light-Getränke', 0.3, 0, 0, 0, '1 Dose (330 ml)', 330],
  ['Energy-Drink', 46, 0, 11, 0, '1 Dose (250 ml)', 250],
  ['Bier (Pils)', 42, 0.5, 3, 0, '1 Flasche (0,5 l)', 500],
  ['Weizenbier', 45, 0.5, 3.5, 0, '1 Flasche (0,5 l)', 500],
  ['Bier, alkoholfrei', 25, 0.4, 5.3, 0, '1 Flasche (0,5 l)', 500],
  ['Wein, trocken', 70, 0.1, 0.5, 0, '1 Glas (200 ml)', 200],
  ['Kaffee, schwarz', 2, 0.2, 0.3, 0, '1 Tasse (200 ml)', 200],
  ['Cappuccino, Milchkaffee', 35, 1.8, 2.7, 1.8, '1 Tasse (200 ml)', 200],
  ['Proteinpulver (Whey)', 385, 78, 7, 5, '1 Messlöffel', 30],
  ['Proteinpulver, vegan', 380, 75, 6, 6, '1 Messlöffel', 30],
  ['Wasser, Tee (ungesüßt)', 0, 0, 0, 0, '1 Glas (250 ml)', 250],
  // Gerichte
  ['Haferbrei (Porridge) mit Milch', 115, 4.6, 14, 4.1, '1 Schüssel', 300],
  ['Spaghetti Bolognese', 150, 7, 20, 4.5, '1 Teller', 400],
  ['Lasagne', 140, 7, 12, 7, '1 Portion', 400],
  ['Pizza Margherita', 230, 10, 30, 8, '1 Pizza', 350],
  ['Pizza Salami', 255, 11, 28, 11, '1 Pizza', 350],
  ['Hamburger', 245, 12, 30, 8.5, '1 Hamburger', 110],
  ['Cheeseburger', 260, 13, 27, 11, '1 Cheeseburger', 120],
  ['Linseneintopf', 90, 5, 10, 3, '1 Teller', 350],
  ['Kartoffelsalat mit Mayonnaise', 180, 1.8, 13, 13, '1 Portion', 200],
  ['Kartoffelsalat mit Essig und Öl', 95, 1.7, 13, 4, '1 Portion', 200],
];

// Ballaststoffe und Zucker (gesamt) je 100 g zur Grundliste: Werte des passenden Eintrags im Bundeslebensmittelschlüssel 4.0,
// ohne passenden Eintrag (Proteinpulver, -riegel, -pudding, Energy-Drink, Tomatensoße) grob geschätzt
const FOOD_BASE_FS = {
  'Haferflocken': [11, 0.7],
  'Reis, roh': [2.5, 0.3],
  'Reis, gekocht': [0.6, 0.1],
  'Vollkornreis, roh': [4, 0.7],
  'Nudeln, roh': [3.4, 2],
  'Nudeln, gekocht': [1.5, 0.8],
  'Vollkornnudeln, roh': [10.2, 2.8],
  'Kartoffeln, gekocht': [2, 0.7],
  'Süßkartoffel': [3.1, 5.5],
  'Pommes frites, zubereitet': [2.5, 1.6],
  'Bratkartoffeln': [3.3, 1.1],
  'Kartoffelpüree, mit Milch': [0.9, 1.7],
  'Couscous, roh': [6.2, 1.1],
  'Bulgur, roh': [6.7, 1.9],
  'Quinoa, roh': [9.7, 1.7],
  'Hirse, roh': [3.3, 0.6],
  'Grieß, roh': [4.1, 0.8],
  'Weizenmehl': [5.3, 0.3],
  'Cornflakes': [4.1, 0.7],
  'Müsli, ohne Zuckerzusatz': [10.4, 11.3],
  'Knuspermüsli (Crunchy)': [7.7, 19.2],
  'Reiswaffel': [3.6, 0.4],
  'Knäckebrot': [18.2, 1.8],
  'Vollkornbrot': [10, 0.8],
  'Mischbrot': [7.2, 0.7],
  'Toastbrot (Weizen)': [3.9, 3.7],
  'Vollkorntoast': [7.9, 1.6],
  'Brötchen (Weizen)': [3.6, 3.1],
  'Vollkornbrötchen': [9.8, 1.4],
  'Laugenbrezel': [3.7, 1.4],
  'Croissant': [2.6, 7.2],
  'Baguette': [3.7, 1.5],
  'Wrap (Weizentortilla)': [1.2, 1.3],
  'Fladenbrot': [3.3, 0.3],
  'Pfannkuchen': [2, 2.5],
  'Milch 3,5 %': [0, 4],
  'Milch 1,5 %': [0, 4.6],
  'Haferdrink': [0.5, 3.8],
  'Sojadrink, ungesüßt': [1.8, 0.4],
  'Magerquark': [0, 3.7],
  'Speisequark 20 %': [0, 3],
  'Speisequark 40 %': [0, 2.6],
  'Skyr natur': [0.2, 3.1],
  'Joghurt natur 3,5 %': [0, 4.1],
  'Joghurt natur 1,5 %': [0, 5.8],
  'Griechischer Joghurt 10 %': [0, 4.5],
  'Fruchtjoghurt': [1.1, 12.1],
  'Hüttenkäse (körniger Frischkäse)': [0, 3.6],
  'Frischkäse natur (Doppelrahm)': [0.6, 3.7],
  'Frischkäse leicht': [0, 3.2],
  'Gouda': [0, 0],
  'Emmentaler': [0, 0],
  'Mozzarella': [0, 0],
  'Mozzarella light': [0, 0],
  'Feta (Schafskäse)': [0, 0],
  'Parmesan': [0, 0.1],
  'Harzer Käse': [0, 0],
  'Butter': [0, 0.6],
  'Schlagsahne 30 %': [0, 3.3],
  'Saure Sahne 10 %': [0, 4.1],
  'Schmand 24 %': [0, 3],
  'Crème fraîche': [0, 2.5],
  'Proteinpudding': [0.5, 4],
  'Pudding (Schoko), fertig': [0.2, 12.1],
  'Ei': [0, 0.3],
  'Eiklar': [0, 0.4],
  'Spiegelei, in Fett gebraten': [0, 0.4],
  'Hähnchenbrust, roh': [0, 0],
  'Hähnchenbrust, gebraten': [0, 0],
  'Putenbrust, roh': [0, 0],
  'Hähnchenschenkel mit Haut, roh': [0, 0],
  'Rinderhackfleisch (20 % Fett), roh': [0, 0],
  'Rinderhackfleisch mager (5 % Fett), roh': [0, 0],
  'Hackfleisch gemischt, roh': [0, 0],
  'Rindersteak (Hüfte, Rumpsteak), roh': [0, 0],
  'Schweinefilet, roh': [0, 0],
  'Schweineschnitzel, roh': [0, 0],
  'Schweinenacken, roh': [0, 0],
  'Kasseler': [0, 0.6],
  'Schnitzel paniert, gebraten': [0.6, 0.5],
  'Frikadelle': [0.7, 0.8],
  'Gyros (Fleisch)': [0.3, 0.5],
  'Rindergulasch': [1.2, 4.5],
  'Frühstücksspeck (Bacon)': [0, 0.6],
  'Kochschinken': [0, 0.5],
  'Putenbrust-Aufschnitt': [0, 0],
  'Salami': [0.1, 0],
  'Leberwurst': [0.1, 0.2],
  'Fleischwurst (Lyoner)': [0, 0.2],
  'Wiener Würstchen': [0.3, 0.1],
  'Bratwurst': [0.1, 0],
  'Leberkäse': [0.1, 0],
  'Currywurst mit Soße': [0.7, 8],
  'Döner Kebab im Brot': [1.6, 1.1],
  'Lachs, roh': [0, 0],
  'Thunfisch im eigenen Saft (abgetropft)': [0, 0],
  'Thunfisch in Öl (abgetropft)': [0, 0],
  'Seelachs, roh': [0, 0],
  'Kabeljau, roh': [0, 0],
  'Garnelen, roh': [0, 0],
  'Fischstäbchen': [0.9, 1.1],
  'Matjesfilet': [0, 0],
  'Makrele, geräuchert': [0, 0],
  'Sushi (Maki)': [0.8, 0.4],
  'Linsen, roh': [17.6, 1.3],
  'Linsen, gekocht': [3, 0.4],
  'Kichererbsen (Dose, abgetropft)': [9.8, 1.2],
  'Kidneybohnen (Dose, abgetropft)': [11.2, 0.9],
  'Weiße Bohnen (Dose, abgetropft)': [8.8, 0.8],
  'Erbsen (TK)': [5.3, 5.4],
  'Edamame (TK)': [4.2, 1.3],
  'Tofu natur': [1.3, 0],
  'Räuchertofu': [1.3, 0],
  'Sojaschnetzel, trocken': [18.1, 13.5],
  'Falafel': [7.5, 1.7],
  'Hummus': [5.9, 0.7],
  'Erdnussbutter': [7.4, 11.7],
  'Erdnüsse, geröstet': [8.4, 4.9],
  'Mandeln': [10, 3.6],
  'Walnüsse': [4.6, 2.7],
  'Haselnüsse': [7.6, 3.9],
  'Cashewkerne': [3, 6.2],
  'Pistazien': [16.3, 6.6],
  'Nussmischung (Studentenfutter)': [6.2, 29.6],
  'Chiasamen': [40.2, 0.5],
  'Leinsamen': [22.7, 1.2],
  'Sonnenblumenkerne': [5.8, 3.5],
  'Kürbiskerne': [8.7, 1.3],
  'Kokosraspeln': [14.8, 7.1],
  'Apfel': [2.3, 10.5],
  'Banane': [2, 13.9],
  'Birne': [2.8, 10.1],
  'Orange': [2.2, 8.8],
  'Mandarine, Clementine': [1.7, 9.2],
  'Kiwi': [3.9, 10.1],
  'Erdbeeren': [2, 5.9],
  'Heidelbeeren': [4.9, 9.7],
  'Himbeeren': [4.7, 5.2],
  'Weintrauben': [0.6, 15.5],
  'Ananas': [1.4, 9.4],
  'Mango': [1.7, 11],
  'Wassermelone': [0.2, 6.7],
  'Pfirsich, Nektarine': [1.7, 7],
  'Kirschen': [1.9, 13.7],
  'Pflaumen': [1.7, 8.1],
  'Avocado': [4.1, 1.4],
  'Apfelmus, ungesüßt': [1.1, 11.1],
  'Rosinen': [5.4, 60.9],
  'Datteln, getrocknet': [11.2, 78.9],
  'Brokkoli': [3, 1.4],
  'Blumenkohl': [2.9, 2.2],
  'Paprika': [2.2, 6.2],
  'Tomate': [1.3, 3.2],
  'Gurke': [0.9, 2],
  'Karotte (Möhre)': [2.9, 6.4],
  'Zucchini': [1.1, 2],
  'Aubergine': [1.4, 2.7],
  'Spinat': [1.8, 0.8],
  'Blattsalat (Kopfsalat, Eisberg, Feldsalat)': [1.8, 1.6],
  'Rucola': [1.7, 0],
  'Zwiebel': [1.4, 6],
  'Champignons': [1.9, 0.2],
  'Mais (Dose, abgetropft)': [3.6, 6.2],
  'Grüne Bohnen': [1.9, 2.3],
  'Kohlrabi': [1.5, 3.7],
  'Rosenkohl': [4, 3.7],
  'Weißkohl, Rotkohl': [3, 4.4],
  'Sauerkraut': [2.1, 0.8],
  'Spargel': [1.3, 1.1],
  'Rote Bete, gekocht': [2.6, 10.4],
  'Kürbis (Hokkaido)': [0.8, 4.6],
  'Gemüsemischung (TK)': [2.9, 3.3],
  'Oliven': [1.6, 0],
  'Gewürzgurken': [0.9, 5.5],
  'Speiseöl (Olivenöl, Rapsöl, Sonnenblumenöl)': [0, 0],
  'Margarine': [0, 0],
  'Mayonnaise': [0.1, 0.4],
  'Ketchup': [1.8, 20.8],
  'Senf': [4.5, 2.8],
  'Pesto (Basilikum)': [2.1, 0.7],
  'Passierte Tomaten (Passata)': [1.8, 3.6],
  'Tomatensoße, fertig': [1.5, 5],
  'Sojasoße': [1.1, 4.9],
  'Balsamico-Essig': [0, 20],
  'Honig': [0, 70.8],
  'Marmelade, Konfitüre': [1.1, 56.3],
  'Nuss-Nougat-Creme': [3.5, 53.1],
  'Zucker': [0, 100],
  'Ahornsirup': [0, 59.9],
  'Vollmilchschokolade': [2.5, 51.4],
  'Zartbitterschokolade 70 %': [10.1, 30],
  'Gummibärchen': [1, 56.7],
  'Butterkekse': [2.4, 27.1],
  'Kartoffelchips': [4.8, 1.5],
  'Salzstangen': [4.2, 2.4],
  'Vanilleeis': [0.3, 18.1],
  'Rührkuchen, Marmorkuchen': [2, 20.6],
  'Käsekuchen': [1.3, 13.1],
  'Müsliriegel': [6.1, 18.7],
  'Proteinriegel': [6, 5],
  'Orangensaft': [0.3, 8.5],
  'Apfelsaft': [0.3, 9.6],
  'Apfelschorle': [0.2, 5.6],
  'Cola': [0, 10.3],
  'Cola zero, Light-Getränke': [0, 0],
  'Energy-Drink': [0, 11],
  'Bier (Pils)': [0, 0.1],
  'Weizenbier': [0, 0.1],
  'Bier, alkoholfrei': [0, 2.4],
  'Wein, trocken': [0, 0.7],
  'Kaffee, schwarz': [0.3, 0],
  'Cappuccino, Milchkaffee': [0.1, 4],
  'Proteinpulver (Whey)': [0, 5],
  'Proteinpulver, vegan': [5, 2],
  'Wasser, Tee (ungesüßt)': [0, 0],
  'Haferbrei (Porridge) mit Milch': [2.2, 4.2],
  'Spaghetti Bolognese': [1.2, 1.6],
  'Lasagne': [1.2, 3.1],
  'Pizza Margherita': [1.9, 1.6],
  'Pizza Salami': [1.7, 1.4],
  'Hamburger': [1.7, 3.7],
  'Cheeseburger': [1.2, 3.4],
  'Linseneintopf': [5.6, 1.7],
  'Kartoffelsalat mit Mayonnaise': [1.4, 1.1],
  'Kartoffelsalat mit Essig und Öl': [1.6, 1.2],
};

// zusätzliche Suchbegriffe (Wortanfang des Namens genügt nicht immer, z. B. „Käse“ → Gouda)
const FOOD_TAGS = [
  ['käse', ['Gouda', 'Emmentaler', 'Mozzarella', 'Mozzarella light', 'Parmesan', 'Feta (Schafskäse)', 'Frischkäse natur (Doppelrahm)']],
  ['fisch', ['Lachs, roh', 'Thunfisch im eigenen Saft (abgetropft)', 'Thunfisch in Öl (abgetropft)', 'Seelachs, roh', 'Kabeljau, roh', 'Matjesfilet', 'Makrele, geräuchert', 'Garnelen, roh']],
  ['fleisch huhn hühnchen chicken', ['Hähnchenbrust, roh', 'Hähnchenbrust, gebraten', 'Hähnchenschenkel mit Haut, roh']],
  ['fleisch', ['Putenbrust, roh', 'Rindersteak (Hüfte, Rumpsteak), roh', 'Schweinefilet, roh', 'Schweineschnitzel, roh', 'Schweinenacken, roh', 'Rinderhackfleisch (20 % Fett), roh', 'Rinderhackfleisch mager (5 % Fett), roh']],
  ['wurst aufschnitt', ['Salami', 'Kochschinken', 'Putenbrust-Aufschnitt', 'Frühstücksspeck (Bacon)']],
  ['eier rührei', ['Ei', 'Spiegelei, in Fett gebraten']],
  ['pasta spaghetti', ['Nudeln, roh', 'Nudeln, gekocht', 'Vollkornnudeln, roh']],
  ['kartoffel', ['Pommes frites, zubereitet', 'Kartoffelchips']],
  ['joghurt', ['Skyr natur']],
  ['nüsse', ['Mandeln', 'Walnüsse', 'Haselnüsse', 'Cashewkerne', 'Pistazien', 'Erdnüsse, geröstet']],
  ['brot', ['Laugenbrezel', 'Croissant', 'Baguette', 'Knäckebrot']],
  ['shake protein eiweiß', ['Proteinpulver (Whey)', 'Proteinpulver, vegan']],
  ['schokolade süßigkeiten', ['Gummibärchen', 'Nuss-Nougat-Creme']],
  ['salat', ['Rucola']],
];
const FOOD_TAG_MAP = new Map();
for (const [words, names] of FOOD_TAGS) for (const n of names) FOOD_TAG_MAP.set(n, ((FOOD_TAG_MAP.get(n) || '') + ' ' + words).trim());

const MEALS = { b: ['🌅', 'Frühstück'], l: ['☀️', 'Mittagessen'], d: ['🌙', 'Abendessen'], s: ['🍎', 'Snacks'] };

const FOOD_BASE_LIST = FOOD_BASE.map(([name, kcal, p, c, f, pl, pg]) => (
  { key: 'b:' + name, name, brand: '', per: [kcal, p, c, f, ...(FOOD_BASE_FS[name] || [null, null])], portion: pl ? { label: pl, g: pg } : null, src: 'base', tags: FOOD_TAG_MAP.get(name) || '' }));
const FOOD_BASE_MAP = new Map(FOOD_BASE_LIST.map(f => [f.key, f]));
// Bundeslebensmittelschlüssel (bls.js, über 7000 Durchschnittswerte, key 'bls:' + BLS-Code): erst bei Bedarf aufbereitet
// Oberbegriffe je BLS-Hauptgruppe (1. Buchstabe des Codes) – damit „Obst“, „Fisch“, „Nudeln“ … auch passende Einträge finden
const BLS_GROUP_TAGS = { B: 'brot', C: 'getreide', D: 'kuchen gebäck', E: 'nudeln pasta', F: 'obst', G: 'gemüse',
  H: 'hülsenfrüchte nüsse', K: 'kartoffeln pilze', M: 'milchprodukte', N: 'getränke', P: 'alkohol', Q: 'fett öl',
  R: 'gewürze', S: 'süßigkeiten', T: 'fisch', U: 'fleisch', V: 'fleisch geflügel', W: 'wurst aufschnitt', X: 'gericht', Y: 'gericht' };
let foodBls = null;
function foodBlsList() {
  if (foodBls) return foodBls;
  foodBls = { list: [], map: new Map() };
  if (typeof BLS_DATA !== 'string') return foodBls;
  for (const line of BLS_DATA.split('\n')) {
    const [code, name, kcal, p, c, f, fib, sug] = line.split('|');
    if (!name) continue;
    const tags = (BLS_GROUP_TAGS[code[0]] || '') + (/Fett i\. Tr\./.test(name) ? ' käse' : '');
    const it = { key: 'bls:' + code, name, brand: '', per: [+kcal, +p, +c, +f, +fib, +sug], portion: null, src: 'bls', tags };
    foodBls.list.push(it);
    foodBls.map.set(it.key, it);
  }
  return foodBls;
}
// fest eingebaut (Grundliste oder BLS): in data.foods nur { fav, last }
const foodBuiltin = f => f.src === 'base' || f.src === 'bls';
const FOOD_TEXT = new WeakMap();  // Suchtext je fest eingebautem Lebensmittel
const foodCache = new Map();  // Treffer aus Open Food Facts, die noch nicht gemerkt sind

let foodQuery = '';     // Suchtext beim Hinzufügen
let foodOnline = null;  // Online-Suche: { q, status: 'loading' | 'done' | 'error', hits }
let foodAmt = null;     // Menge-Seite: { for, g (Text), meal }
let foodForm = null;    // Formular „Eigenes Lebensmittel“

// Lebensmittel zu einem Schlüssel (Grundliste mit gemerkten Angaben wie Favorit, sonst gemerkt oder aus der Online-Suche)
function foodGet(key) {
  const m = data.foods[key];
  const b = FOOD_BASE_MAP.get(key) || (String(key).startsWith('bls:') ? foodBlsList().map.get(key) : null);
  if (b) return { ...b, fav: !!(m && m.fav), last: m && m.last };
  return m || foodCache.get(key) || null;
}

// Als „zuletzt gegessen“ merken (Grundliste: nur Zeitpunkt und Favorit)
function foodRemember(f, extra = {}) {
  const old = data.foods[f.key] || {};
  data.foods[f.key] = foodBuiltin(f)
    ? { fav: !!old.fav, last: Date.now(), ...extra }
    : { key: f.key, name: f.name, brand: f.brand || '', per: f.per, portion: f.portion || null, code: f.code || null,
        src: f.src, fav: !!old.fav, last: Date.now(), ...extra };
}

const foodVal = (per, g) => per.map(v => (v || 0) * g / 100);
// Ballaststoffe und Zucker je 100 g eines Eintrags; ältere Einträge aus den festen Listen (Grundliste, BLS) bekommen sie
// aus der Liste nachgereicht. null = unbekannt (z. B. ältere Markenprodukte, eigene Lebensmittel ohne Angabe)
function foodFS(e) {
  const per = e.per || [];
  if (per[4] != null || per[5] != null) return [per[4] || 0, per[5] || 0];
  if (/^(b|bls):/.test(e.key || '')) {
    const f = foodGet(e.key);
    if (f && f.per[4] != null) return [f.per[4], f.per[5] || 0];
  }
  return null;
}
// Summe: kcal und Makros; dazu Ballaststoffe/Zucker der Einträge mit Angabe und miss = Einträge ohne (ohne „Aufgefüllt“)
function foodTotals(list) {
  const t = [0, 0, 0, 0];
  let fib = 0, sug = 0, miss = 0;
  for (const e of list) {
    foodVal(e.per.slice(0, 4), e.g).forEach((v, i) => { t[i] += v; });
    if (e.key === FOOD_FILL) continue;
    const fs = foodFS(e);
    if (!fs) { miss++; continue; }
    fib += fs[0] * e.g / 100;
    sug += fs[1] * e.g / 100;
  }
  return { kcal: t[0], p: t[1], c: t[2], f: t[3], fib, sug, miss };
}
const foodOn = date => data.foodLog.filter(e => e.date === date);

// Tagessumme in data.intake übernehmen (src 'food') bzw. entfernen, wenn der Tag leer ist
function foodSync(date) {
  const list = foodOn(date);
  if (list.length) {
    const t = foodTotals(list);
    saveIntake(date, { kcal: Math.round(t.kcal), p: Math.round(t.p), c: Math.round(t.c), f: Math.round(t.f) }, 'food');
  } else if ((intakeOn(date) || {}).src === 'food') {
    data.intake = data.intake.filter(x => x.date !== date);
  }
}

const FOOD_FILL = 'fill';  // Eintrag „Nicht erfasst (aufgefüllt)“
const foodClosed = date => !!data.foodClosed[date];

// Änderung an einem abgeschlossenen Tag: wieder öffnen (Auffüllung passt dann nicht mehr) – true, wenn er zu war
function foodReopen(date) {
  if (!foodClosed(date)) return false;
  delete data.foodClosed[date];
  data.foodLog = data.foodLog.filter(e => !(e.date === date && e.key === FOOD_FILL));
  return true;
}
const foodReopenToast = () => toast('Tag wieder geöffnet – schließ ihn am Ende neu ab');

// Rest bis zum Tagesziel (null ohne Ziel oder wenn nichts fehlt)
function foodRest(date) {
  const c = foodGoal(date);
  if (!c) return null;
  const t = foodTotals(foodOn(date).filter(e => e.key !== FOOD_FILL));
  const r = { kcal: Math.round(c.kcal - t.kcal), p: Math.max(0, Math.round(c.protein - t.p)), c: Math.max(0, Math.round(c.carbs - t.c)), f: Math.max(0, Math.round(c.fat - t.f)) };
  return r.kcal >= 50 ? r : null;
}

// Mahlzeiten, die an diesem Tag leer sind, aber sonst fast immer eingetragen werden (letzte 14 Tage mit Einträgen)
function foodUsualMissing(date) {
  const days = [];
  for (let i = 1; i <= 14; i++) { const d = addDaysISO(date, -i); const l = foodOn(d); if (l.length) days.push(l); }
  if (days.length < 5) return [];
  const today = foodOn(date);
  return Object.keys(MEALS).filter(k => !today.some(e => e.meal === k)
    && days.filter(l => l.some(e => e.meal === k)).length / days.length >= 0.8).map(k => MEALS[k][1]);
}

// Tag abschließen (fill: Rest mit dem Tagesziel auffüllen)
function foodCloseDay(date, fill) {
  foodReopen(date);
  const r = fill ? foodRest(date) : null;
  if (r) data.foodLog.push({ id: uid(), date, meal: 'f', key: FOOD_FILL, name: 'Nicht erfasst (aufgefüllt)', brand: '', g: 100, per: [r.kcal, r.p, r.c, r.f] });
  data.foodClosed[date] = true;
  foodSync(date);
}

// vergangene Tage (letzte 7) mit Einträgen, die noch nicht abgeschlossen sind – neueste zuerst
function foodOpenDays() {
  if (nutPaused()) return [];  // Phase unterbrochen: keine Erinnerungen
  const out = [];
  for (let i = 1; i <= 7; i++) { const d = addDaysISO(todayISO(), -i); if (!foodClosed(d) && foodOn(d).length && !nutPausedOn(d)) out.push(d); }
  return out;
}

// Karte „Tag noch nicht abgeschlossen“ (Ernährungs-Reiter und Tagebuch)
function foodOpenCard() {
  const open = foodOpenDays();
  if (!open.length) return '';
  const d = open[0];
  const label = d === addDaysISO(todayISO(), -1) ? 'Gestern' : new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'numeric' });
  const t = foodTotals(foodOn(d));
  const rest = foodRest(d);
  const miss = foodUsualMissing(d);
  return `<div class="card food-opencard">
      <p><b>📋 ${label} ist noch nicht abgeschlossen</b></p>
      <p class="hint nut-small">Eingetragen: ${nutKcal(t.kcal)} kcal.${miss.length ? ` ${miss.join(' und ')} ${miss.length > 1 ? 'sind' : 'ist'} leer – sonst trägst du ${miss.length > 1 ? 'sie' : 'es'} fast immer ein.` : ''}
        Erst abgeschlossene Tage zählen für den gemessenen Bedarf.${open.length > 1 ? ` Noch ${open.length - 1} weitere${open.length > 2 ? '' : 'r'} Tag${open.length > 2 ? 'e' : ''} offen.` : ''}</p>
      <button class="btn primary" data-action="food-close" data-date="${d}" data-fill="0">✔ Alles eingetragen</button>
      ${rest ? `<button class="btn" data-action="food-close" data-date="${d}" data-fill="1">➕ Rest mit Tagesziel auffüllen (+${nutKcal(rest.kcal)} kcal)</button>` : ''}
      <button class="btn center" data-action="food-open" data-date="${d}">Tag ansehen</button>
    </div>`;
}

let foodCloseAsk = null;  // Datum, für das die Frage „Alles eingetragen?“ offen ist

function foodCloseHtml(date, list) {
  const real = list.filter(e => e.key !== FOOD_FILL);
  if (foodClosed(date)) {
    const fill = list.find(e => e.key === FOOD_FILL);
    return `<div class="card food-closed">
        <p><b>✔ Tag abgeschlossen</b>${fill ? ` · Rest aufgefüllt (${nutKcal(fill.per[0])} kcal)` : ''}</p>
        <button class="btn" data-action="food-reopen">Wieder öffnen</button></div>`;
  }
  if (foodCloseAsk !== date) {
    return `<button class="btn primary" data-action="food-close-ask">✔ Tag abschließen</button>`;
  }
  const rest = foodRest(date);
  const miss = foodUsualMissing(date);
  const c = foodGoal(date);
  return `<div class="card food-close">
      <p><b>Hast du ${date === todayISO() ? 'heute' : 'an diesem Tag'} alles eingetragen?</b></p>
      ${miss.length ? `<p class="food-miss">⚠️ ${miss.join(' und ')} ${miss.length > 1 ? 'sind' : 'ist'} leer – sonst trägst du ${miss.length > 1 ? 'sie' : 'es'} fast immer ein.</p>` : ''}
      <p class="hint nut-small">Eingetragen: ${nutKcal(foodTotals(real).kcal)} kcal${c ? ` · Tagesziel ${nutKcal(c.kcal)} kcal` : ''}.</p>
      ${real.length ? '<button class="btn primary" data-action="food-close" data-fill="0">✔ Ja, alles eingetragen</button>' : ''}
      ${rest ? `<button class="btn" data-action="food-close" data-fill="1">➕ Rest mit Tagesziel auffüllen (+${nutKcal(rest.kcal)} kcal)</button>
        <p class="hint nut-small">Für Tage, an denen du nicht alles aufgeschrieben hast: Die App ergänzt, was bis zu deinem Tagesziel fehlt
          (auch Eiweiß, Kohlenhydrate und Fett). So bleibt der gemessene Bedarf genau, statt durch fehlende Einträge zu niedrig zu werden.</p>` : ''}
      <button class="btn center" data-action="food-close-cancel">Abbrechen</button>
    </div>`;
}

const foodNum = v => fmtNum(round1(v));
const foodKcal = v => deNum(Math.round(v || 0));
function foodDayLabel(date) {
  const long = new Date(date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  const rel = date === todayISO() ? 'Heute' : date === addDaysISO(todayISO(), -1) ? 'Gestern' : '';
  return rel ? `${rel}<small>${long}</small>` : long;
}

// Tagesziel (falls die Ernährung eingerichtet ist)
function foodGoal(date = todayISO()) {
  if (nutPausedOn(date)) return null;  // Phase unterbrochen: kein Tagesziel
  if (typeof nutPlanActive === 'function' && nutPlanActive()) return nutForDay(null, date);  // Ernährungsplan
  const n = data.nutrition;
  const kg = nutWeight();
  return n && nutReady(n) && kg != null ? nutForDay(nutCalc(n, kg), date) : null;  // inkl. Cardio (wenn eingerechnet)
}

function foodSumHtml(t, c) {
  if (c) {
    return `${nutIntakeBar('Kalorien', Math.round(t.kcal), c.kcal, 'kcal', 0.1)}
      ${nutIntakeBar('Eiweiß', Math.round(t.p), c.protein, 'g', 0, c.pLo)}
      ${feat('nut-macros') ? nutIntakeBar('Kohlenhydrate', Math.round(t.c), c.carbs, 'g', 0.25) + nutIntakeBar('Fett', Math.round(t.f), c.fat, 'g', 0.25) : ''}`;
  }
  return `<div class="nut-goal-row food-sum"><span>Kalorien<b>${nutKcal(t.kcal)}</b></span><span>Eiweiß<b>${Math.round(t.p)} g</b></span>
      <span>Kohlenh.<b>${Math.round(t.c)} g</b></span><span>Fett<b>${Math.round(t.f)} g</b></span></div>
    <p class="hint nut-small">Richte im Reiter „Ernährung“ deine Phase und Angaben ein, dann siehst du hier dein Tagesziel.</p>`;
}

// Ballaststoffe und Zucker: nur zum Mitverfolgen – keine Tagesziele, aufklappbar ein paar grobe Richtwerte
function foodFsHtml(t, c) {
  const kcal = c && c.kcal ? Math.round(c.kcal / 100) * 100 : null;
  const miss = t.miss ? `<p class="hint nut-small">${t.miss === 1 ? '1 Eintrag hat' : `${t.miss} Einträge haben`} keine Angabe dazu
    (z. B. ältere Markenprodukte oder eigene Lebensmittel) und ${t.miss === 1 ? 'zählt' : 'zählen'} hier nicht mit.</p>` : '';
  return `<div class="food-fs"><span>🌾 Ballaststoffe <b>${Math.round(t.fib)} g</b></span><span>🍬 Zucker <b>${Math.round(t.sug)} g</b></span></div>
    ${miss}
    <details class="prog-help food-fs-help"><summary>ⓘ Grobe Richtwerte</summary>
      <p><b>Ballaststoffe:</b> Empfohlen sind mindestens 30 g am Tag; wer viel isst, orientiert sich grob an 10 g je 1.000 kcal${kcal > 3000
        ? ` (bei deinen rund ${fmtNum(kcal)} kcal also etwa ${Math.round(kcal / 100)} g)` : ''}. Viele kommen nur auf
        etwa 20 g. Gute Quellen: Vollkorn, Haferflocken, Hülsenfrüchte, Gemüse, Obst, Nüsse und Samen. Mehr ist meist gut –
        langsam steigern und genug trinken, sonst kann es anfangs zwicken.</p>
      <p><b>Zucker:</b> Gezählt ist der gesamte Zucker, auch der aus Obst, Gemüse und Milch. Die Empfehlung, höchstens etwa 10 %
        der Kalorien als Zucker zu essen${kcal ? ` (bei dir rund ${Math.round(kcal / 40)} g)` : ' (bei 2.000 kcal rund 50 g)'},
        gilt nur für <i>zugesetzten</i> Zucker – dazu zählen auch Honig, Sirup und Fruchtsaft. Den kann die App nicht getrennt
        ausweisen. Faustregel: Kommt der Zucker vor allem aus Obst und Milchprodukten, ist das unbedenklich; aus Süßigkeiten,
        Limo und Saft lohnt es sich, ihn im Blick zu behalten.</p>
      <p class="hint">Das sind keine Ziele, nur Anhaltspunkte. Die Werte sind Durchschnittswerte.</p>
    </details>`;
}

/* ----- Tagesansicht ----- */

function renderFood(p) {
  const date = p.date || todayISO();
  const list = foodOn(date);
  const yesterday = foodOn(addDaysISO(date, -1));
  const t = foodTotals(list);
  let h = `<div class="food-date">
      <button class="icon-btn" data-action="food-day" data-d="-1" aria-label="Vorheriger Tag">‹</button>
      <b>${foodDayLabel(date)}</b>
      <button class="icon-btn" data-action="food-day" data-d="1" ${date >= todayISO() ? 'disabled' : ''} aria-label="Nächster Tag">›</button>
    </div>
    <div class="card nut-intake">${foodSumHtml(t, foodGoal(date))}${list.some(e => e.key !== FOOD_FILL) ? foodFsHtml(t, foodGoal(date)) : ''}</div>
    ${date === todayISO() ? foodOpenCard() : ''}`;
  const planDay = typeof nutPlanActive === 'function' && nutPlanActive() ? nutPlanDay(date) : null;
  const planMeals = (planDay && planDay.meals) || {};
  for (const [k, [icon, label]] of Object.entries(MEALS)) {
    const items = list.filter(e => e.meal === k);
    const kcal = foodTotals(items).kcal;
    const prev = yesterday.filter(e => e.meal === k);
    h += `<div class="card food-meal">
        <div class="food-meal-head"><b>${icon} ${label}</b><span class="hint">${items.length ? nutKcal(kcal) + ' kcal' : ''}</span></div>
        ${items.map(e => `<div class="food-row">
          <button class="food-pick" data-action="food-entry" data-id="${e.id}">
            <span>${esc(e.name)}<small>${e.brand ? esc(e.brand) + ' · ' : ''}${foodNum(e.g)} g</small></span>
            <b>${foodKcal(foodVal(e.per, e.g)[0])} kcal</b></button>
          <button class="icon-btn danger" data-action="food-del" data-id="${e.id}" aria-label="Entfernen">✕</button></div>`).join('')}
        ${!items.length && planMeals[k] ? `<p class="hint nut-small np-plan-hint">📋 Plan: ${planMeals[k].map(i => `${esc(i.name)}${i.g ? ` ${fmtNum(i.g)} g` : ''}`).join(' · ')}</p>` : ''}
        <div class="row">
          ${!items.length && planMeals[k] ? `<button class="btn primary" data-action="food-plan-meal" data-meal="${k}">✔ Wie geplant</button>` : ''}
          <button class="btn" data-action="food-add" data-meal="${k}">＋ Hinzufügen</button>
          ${!items.length && prev.length ? `<button class="btn" data-action="food-copy" data-meal="${k}">↺ Wie gestern</button>` : ''}
          ${items.length ? `<button class="btn" data-action="food-meal-save" data-meal="${k}">💾 Speichern</button>` : ''}
        </div>
      </div>`;
  }
  const fill = list.find(e => e.key === FOOD_FILL);
  if (fill) {
    const [kc, pr, ca, fa] = fill.per;
    h += `<div class="card food-meal food-fill">
        <div class="food-meal-head"><b>➕ Aufgefüllt bis zum Tagesziel</b><span class="hint">${nutKcal(kc)} kcal</span></div>
        <p class="hint nut-small">Nicht erfasst – geschätzt: Eiweiß ${pr} g · Kohlenhydrate ${ca} g · Fett ${fa} g</p></div>`;
  }
  h += foodCloseHtml(date, list);
  return h + `<p class="hint nut-small">Die Tagessumme zählt automatisch für „Heute gegessen“, die letzten 14 Tage und den gemessenen
    Bedarf. Werte der Grundliste sind Durchschnittswerte – bei Markenprodukten ist der Barcode genauer.</p>`;
}

/* ----- Hinzufügen: Suche ----- */

function foodHit(f) {
  return `<button class="btn nav food-hit" data-action="food-pick" data-key="${esc(f.key)}">
      <span class="lib-txt">${f.fav ? '⭐ ' : ''}${esc(f.name)}<small>${f.brand ? esc(f.brand) + ' · ' : ''}${foodKcal(f.per[0])} kcal · Eiweiß ${foodNum(f.per[1])} g je 100 g</small></span></button>`;
}

// Suchtext: Name, Name ohne Leerzeichen (so findet „Hähnchenbrust“ auch „Hähnchen Brust, ohne Haut, roh“ aus dem BLS),
// Zusatzbegriffe und alles zusammen (mit Marke)
function foodText(f) {
  const name = norm(f.name), compact = name.replace(/\s+/g, ''), tags = norm(f.tags || '');
  return { name, compact, tags, text: name + ' ' + norm(f.brand || '') + ' ' + tags + ' ' + name.replace(/[\s,/()-]+/g, '') };
}
// Suchwort und seine Einzahl-Formen (der BLS nennt „Linse“, „Tomate“, „Kartoffel“ – gesucht wird oft „Linsen“ …)
function foodStems(w) {
  const v = [w];
  if (w.length >= 5 && w.endsWith('n')) v.push(w.slice(0, -1));
  if (w.length >= 6 && w.endsWith('en')) v.push(w.slice(0, -2));
  return v;
}
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Wie gut passt das (erste) Suchwort? Kleiner = besser. Im Deutschen steckt die Bedeutung am Wortende:
// „Butterkäse“ ist ein Käse, „Käsekuchen“ nicht – daher Wortende vor zusammengesetztem Wortanfang.
function foodWordScore(t, w, base) {
  const letter = ch => !!ch && /[a-z]/.test(ch);
  if (t.name.startsWith(w) && !letter(t.name[w.length])) return 0;        // „Apfel“, „Apfel roh“
  if (t.compact.startsWith(w) && !letter(t.compact[w.length])) return 0.1;  // „Hafer Flocken“ für „Haferflocken“
  if (base && new RegExp('(^|\\s)' + reEsc(w)).test(t.tags)) return 0.3;    // Zusatzbegriffe der Grundliste („Käse“ → Gouda)
  if (new RegExp(reEsc(w) + '($|[^a-z])').test(t.name)) return 0.5;         // Wortende: „Butterkäse“, „Rind Hackfleisch“
  if (t.name.startsWith(w)) return 0.6;                                    // zusammengesetzt: „Apfelsaft“
  if (new RegExp('(^|\\s)' + reEsc(w)).test(t.tags)) return 0.65;         // Oberbegriff der BLS-Gruppe
  if (new RegExp('(^|[\\s(,/-])' + reEsc(w)).test(t.name)) return 0.8;    // anderes Wort beginnt so
  return 2;
}
// Reihenfolge: eigene/gemerkte und Grundliste vor BLS; Favoriten und zuletzt Gegessenes nach oben;
// im BLS frische vor tiefgefrorenen Varianten; dann kürzere Namen zuerst
function foodSearch(q) {
  const words = norm(q).split(/\s+/).filter(Boolean).map(foodStems);
  if (!words.length) return [];
  const full = norm(q).trim().replace(/\s+/g, ' ');
  const hits = [];
  const check = (f, cached) => {
    let t = cached ? FOOD_TEXT.get(f) : null;
    if (!t) { t = foodText(f); if (cached) FOOD_TEXT.set(f, t); }
    if (!words.every(v => v.some(w => t.text.includes(w)))) return;
    const g = cached ? foodGet(f.key) : f;
    const bls = f.src === 'bls';
    const ws = Math.min(...words[0].filter(w => t.text.includes(w)).map(w => foodWordScore(t, w, !bls)));
    const score = (t.name === full ? -0.3 : 0) + ws - (g.last ? 0.5 : 0) - (g.fav ? 0.5 : 0)
      + (bls ? 0.6 + (/tiefgefroren/.test(t.name) ? 0.3 : 0) : 0);
    hits.push([score, g]);
  };
  for (const key of Object.keys(data.foods)) {
    const f = foodGet(key);
    if (f && !foodBuiltin(f)) check(f, false);
  }
  for (const f of FOOD_BASE_LIST) check(f, true);
  for (const f of foodBlsList().list) check(f, true);
  return hits.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length).slice(0, 50).map(x => x[1]);
}

function foodMealRow(m) {
  const kcal = foodTotals(m.items).kcal;
  return `<div class="food-savedmeal">
      <button class="btn food-hit" data-action="food-meal-add" data-id="${m.id}">
        <span class="lib-txt">🍽️ ${esc(m.name)}<small>${m.items.length} Lebensmittel · ${nutKcal(kcal)} kcal · antippen zum Hinzufügen</small></span></button>
      <button class="icon-btn" data-action="food-meal-rename" data-id="${m.id}" aria-label="Umbenennen">✎</button>
      <button class="icon-btn danger" data-action="food-meal-delete" data-id="${m.id}" aria-label="Löschen">✕</button>
    </div>`;
}

function foodResults() {
  const q = foodQuery.trim();
  const meals = data.foodMeals.filter(m => !q || norm(m.name).includes(norm(q)));
  const mealsHtml = meals.length ? `<p class="food-sec">🍽️ Gespeicherte Mahlzeiten</p>${meals.map(foodMealRow).join('')}` : '';
  if (!q) {
    const known = Object.keys(data.foods).map(foodGet).filter(f => f && (f.last || f.fav));
    const favs = known.filter(f => f.fav).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const recent = known.filter(f => !f.fav).sort((a, b) => b.last - a.last).slice(0, 25);
    if (!favs.length && !recent.length) {
      return mealsHtml + `<p class="hint">Tipp den Namen ein, z. B. „Haferflocken“ oder „Skyr“. Die App sucht in über 7.000 Lebensmitteln
        mit Durchschnittswerten (eigene Grundliste und Bundeslebensmittelschlüssel), auf Wunsch auch online in Open Food Facts
        (viele Markenprodukte). Oder scanne den Barcode auf der Verpackung.</p>
        <p class="hint nut-small">Quelle der Durchschnittswerte u. a.: Max Rubner-Institut, Bundeslebensmittelschlüssel (BLS) 4.0.</p>`;
    }
    return mealsHtml + (favs.length ? `<p class="food-sec">⭐ Favoriten</p>${favs.map(foodHit).join('')}` : '')
      + (recent.length ? `<p class="food-sec">🕘 Zuletzt gegessen</p>${recent.map(foodHit).join('')}` : '');
  }
  const hits = foodSearch(q);
  let h = mealsHtml + (hits.length ? hits.map(foodHit).join('') : `<p class="hint">„${esc(q)}“ ist nicht in der Lebensmittelliste. Versuch es mit einem anderen Wort, z. B. nur „Brot“ statt „Dinkelvollkornbrot“.</p>`);
  const on = foodOnline && foodOnline.q === q ? foodOnline : null;
  h += '<p class="food-sec">🌐 Open Food Facts (online)</p>';
  if (!on) {
    h += `<button class="btn outline" data-action="food-online">„${esc(q)}“ online suchen</button>`;
  } else if (on.status === 'loading') {
    h += '<p class="hint">Suche läuft …</p>';
  } else if (on.status === 'error') {
    h += `<p class="hint">Open Food Facts ist gerade nicht erreichbar. Prüfe die Internetverbindung oder versuch es gleich noch einmal.</p>
      <button class="btn outline" data-action="food-online">Nochmal versuchen</button>`;
  } else {
    h += on.hits.length ? on.hits.map(foodHit).join('') : '<p class="hint">Online nichts gefunden – leg das Lebensmittel einfach selbst an.</p>';
  }
  return h;
}

function foodRefresh() {
  const el = current.view === 'foodadd' && $view.querySelector('#food-results');
  if (el) el.innerHTML = foodResults();
}

function renderFoodAdd() {
  return `<input class="inp lib-search" type="search" enterkeyhint="search" data-field="food-q" autocomplete="off" autocorrect="off"
      spellcheck="false" placeholder="Lebensmittel suchen …" value="${esc(foodQuery)}">
    <div class="row food-tools">
      <button class="btn" data-action="food-scan">📷 Barcode</button>
      <button class="btn" data-action="food-own">＋ Eigenes</button>
    </div>
    <div id="food-results">${foodResults()}</div>`;
}

/* ----- Open Food Facts ----- */

const OFF_FIELDS = 'code,product_name,product_name_de,generic_name,brands,nutriments,serving_quantity';

// path ohne Host: erst die deutsche Seite (die Suche klappt aus dem Browser nur dort), dann die internationale
async function offFetch(path) {
  let err;
  for (const host of ['https://de.openfoodfacts.org', 'https://world.openfoodfacts.org']) {
    try { return await offFetchUrl(host + path); } catch (e) { err = e; }
  }
  throw err;
}

async function offFetchUrl(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok && r.status !== 404) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// Produkt aus Open Food Facts -> Lebensmittel (null ohne Name oder Kalorien)
function offFood(p) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n.energy_100g != null) kcal = n.energy_100g / 4.184;  // nur kJ angegeben
  const name = String(p.product_name_de || p.product_name || p.generic_name || '').trim();
  const brands = Array.isArray(p.brands) ? p.brands.join(',') : String(p.brands || '');
  const r1 = v => round1(Number(v) || 0);
  const opt = v => (v == null || v === '' || isNaN(Number(v)) ? null : round1(Number(v)));  // fehlt = unbekannt
  const sq = parseFloat(p.serving_quantity);
  return {
    key: 'off:' + p.code, code: String(p.code), name, brand: brands.split(',')[0].trim(), src: 'off',
    per: [kcal == null ? null : Math.round(kcal), r1(n.proteins_100g), r1(n.carbohydrates_100g), r1(n.fat_100g),
      opt(n.fiber_100g), opt(n.sugars_100g)],
    portion: sq > 0 && sq < 2000 ? { label: '1 Portion', g: Math.round(sq) } : null,
  };
}
const offUsable = f => f.name && f.per[0] != null;

async function foodSearchOnline(q) {
  foodOnline = { q, status: 'loading', hits: [] };
  foodRefresh();
  try {
    const j = await offFetch('/cgi/search.pl?search_simple=1&action=process&json=1&page_size=25'
      + '&sort_by=unique_scans_n&tagtype_0=countries&tag_contains_0=contains&tag_0=en:germany'
      + `&search_terms=${encodeURIComponent(q)}&fields=${OFF_FIELDS}`);
    const hits = (j.products || []).map(offFood).filter(offUsable);
    hits.forEach(f => { if (!data.foods[f.key]) foodCache.set(f.key, f); });
    if (foodOnline && foodOnline.q === q) foodOnline = { q, status: 'done', hits: hits.map(f => foodGet(f.key) || f) };
  } catch (e) {
    if (foodOnline && foodOnline.q === q) foodOnline = { q, status: 'error', hits: [] };
  }
  foodRefresh();
}

// Barcode: erst bei den gemerkten Lebensmitteln, dann in Open Food Facts nachschlagen
async function foodByCode(code) {
  code = String(code).replace(/\D/g, '');
  if (!code) return;
  const p = { date: current.params.date, meal: current.params.meal };
  const known = Object.values(data.foods).find(f => f && f.code === code);
  if (known) { foodAmt = null; go('foodamt', { ...p, key: known.key }); return; }
  toast('Produkt wird gesucht …');
  let j;
  try {
    j = await offFetch(`/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
  } catch (e) {
    alert('Keine Verbindung zu Open Food Facts. Zum Nachschlagen eines Barcodes braucht die App Internet.');
    return;
  }
  const f = j && j.product ? offFood({ ...j.product, code }) : null;
  if (f && offUsable(f)) {
    foodCache.set(f.key, f);
    foodAmt = null;
    go('foodamt', { ...p, key: f.key });
    return;
  }
  alert(f ? `„${f.name || 'Dieses Produkt'}“ ist in Open Food Facts ohne Nährwerte eingetragen.`
    + '\n\nTrag die Werte einfach von der Verpackung ab (pro 100 g). Beim nächsten Scan kennt die App das Produkt.'
    : 'Dieses Produkt ist in Open Food Facts noch nicht eingetragen.\n\nTrag die Nährwerte einfach von der Verpackung ab (pro 100 g). Beim nächsten Scan kennt die App das Produkt.');
  foodForm = foodFormFrom(f ? { ...f, key: null, per: f.per.map(v => v || null) } : { name: '', brand: '', per: [], code });
  go('foodown', p);
}

/* ----- Barcode-Scanner (Kamera) ----- */

let foodScan = null;  // { stop }
const loadedScripts = {};
const loadScript = src => loadedScripts[src] || (loadedScripts[src] = new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = ok;
  s.onerror = () => { delete loadedScripts[src]; fail(new Error('Laden fehlgeschlagen: ' + src)); };
  document.head.appendChild(s);
}));

function foodScanClose() {
  if (foodScan) { try { foodScan.stop(); } catch (e) { /* schon beendet */ } }
  foodScan = null;
  const el = document.getElementById('scan');
  if (el) el.remove();
}

function foodScanDone(code) {
  if (!foodScan || foodScan.done) return;
  foodScan.done = true;
  if (navigator.vibrate) navigator.vibrate(60);
  foodScanClose();
  foodByCode(code);
}

function foodCodePrompt() {
  const code = prompt('Barcode-Nummer eintippen (die Ziffern unter dem Strichcode):');
  if (code && code.replace(/\D/g, '').length >= 6) foodByCode(code);
  else if (code) alert('Bitte die ganze Nummer eintippen (meist 13 Ziffern).');
}

async function foodScanStart() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { foodCodePrompt(); return; }
  document.body.insertAdjacentHTML('beforeend', `<div class="scan" id="scan">
      <video playsinline muted autoplay></video><div class="scan-frame"></div>
      <p class="scan-msg">Barcode in den Rahmen halten</p>
      <div class="scan-btns"><button class="btn" data-action="scan-type">Nummer eintippen</button>
        <button class="btn" data-action="scan-close">Abbrechen</button></div></div>`);
  const video = document.querySelector('#scan video');
  const scan = foodScan = { stop: () => {} };
  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
  try {
    // Android/Chrome: eingebaute Erkennung; iPhone/Safari: Bibliothek ZXing (wird erst hier geladen)
    if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('ean_13')) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      let on = true;
      scan.stop = () => { on = false; stream.getTracks().forEach(t => t.stop()); };
      if (foodScan !== scan) { scan.stop(); return; }
      video.srcObject = stream;
      await video.play();
      const det = new BarcodeDetector({ formats });
      const loop = async () => {
        if (!on) return;
        try { const r = await det.detect(video); if (r.length) { foodScanDone(r[0].rawValue); return; } } catch (e) { /* nächstes Bild */ }
        setTimeout(loop, 150);
      };
      loop();
    } else {
      await loadScript('zxing.min.js');
      if (foodScan !== scan) return;
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,
        [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E]);
      const reader = new ZXing.BrowserMultiFormatReader(hints, 200);
      scan.stop = () => reader.reset();
      await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, res => { if (res) foodScanDone(res.getText()); });
      if (foodScan !== scan) reader.reset();
    }
  } catch (e) {
    const wasOpen = foodScan === scan;
    foodScanClose();
    if (!wasOpen) return;
    alert(/NotAllowed|Permission/i.test(e && e.name + e.message)
      ? 'Die App darf die Kamera nicht benutzen. Du kannst den Zugriff in den Einstellungen erlauben – oder die Barcode-Nummer eintippen.'
      : 'Die Kamera konnte nicht gestartet werden. Du kannst die Barcode-Nummer stattdessen eintippen.');
    foodCodePrompt();
  }
}

/* ----- Menge ----- */

function foodAmtSum(per, g) {
  const [kcal, p, c, f] = foodVal(per.slice(0, 4), g || 0);
  const fs = per[4] != null || per[5] != null;
  return `<div class="nut-goal-row food-sum"><span>Kalorien<b>${foodKcal(kcal)}</b></span><span>Eiweiß<b>${foodNum(p)} g</b></span>
    <span>Kohlenh.<b>${foodNum(c)} g</b></span><span>Fett<b>${foodNum(f)} g</b></span></div>
    ${fs ? `<p class="hint nut-small food-fs-amt">🌾 Ballaststoffe ${foodNum((per[4] || 0) * (g || 0) / 100)} g · 🍬 Zucker ${foodNum((per[5] || 0) * (g || 0) / 100)} g</p>` : ''}`;
}

// Lebensmittel für die Menge-Seite: aus dem Eintrag (params.id) oder dem Schlüssel (params.key)
function foodAmtFood(p) {
  const e = p.id && data.foodLog.find(x => x.id === p.id);
  if (e) {
    const f = foodGet(e.key);
    const fs = foodFS(e);
    return { e, f: { ...(f || { key: e.key, src: 'own', portion: null }), name: e.name, brand: e.brand,
      per: [...e.per.slice(0, 4), ...(fs || [null, null])] } };
  }
  return { e: null, f: p.key ? foodGet(p.key) : null };
}

function renderFoodAmt(p) {
  const { e, f } = foodAmtFood(p);
  if (!f) return '<p class="hint">Dieses Lebensmittel gibt es nicht mehr.</p>';
  const id = e ? e.id : f.key;
  if (!foodAmt || foodAmt.for !== id) {
    foodAmt = { for: id, g: e ? fmtNum(e.g) : String(f.portion ? f.portion.g : 100), meal: e ? e.meal : p.meal || 's' };
  }
  const g = parseNum(foodAmt.g);
  const chips = [...(f.portion ? [[`${f.portion.label} (${f.portion.g} g)`, f.portion.g], [`2 × (${f.portion.g * 2} g)`, f.portion.g * 2]] : []),
    ...[50, 100, 150, 200, 250].filter(x => !f.portion || (x !== f.portion.g && x !== f.portion.g * 2)).map(x => [`${x} g`, x])];
  const [kcal, pr, ca, fa, fib, sug] = f.per;
  const fsTxt = fib != null || sug != null ? ` · Ballaststoffe ${foodNum(fib || 0)} g · Zucker ${foodNum(sug || 0)} g` : '';
  const src = f.src === 'off' ? ' · aus Open Food Facts' : f.src === 'base' ? ' · Durchschnittswert'
    : f.src === 'bls' ? ' · Durchschnittswert aus dem Bundeslebensmittelschlüssel (Max Rubner-Institut)' : ' · eigenes Lebensmittel';
  return `<div class="card food-amt">
      <p class="food-amt-name"><b>${esc(f.name)}</b>${f.brand ? `<small>${esc(f.brand)}</small>` : ''}</p>
      <p class="hint nut-small">je 100 g: ${foodKcal(kcal)} kcal · Eiweiß ${foodNum(pr)} g · Kohlenhydrate ${foodNum(ca)} g · Fett ${foodNum(fa)} g${fsTxt}${src}</p>
      <label class="row"><span>Menge in Gramm</span>
        <input class="inp kg" id="food-g" type="text" inputmode="decimal" autocomplete="off" data-field="food-g" value="${esc(foodAmt.g)}"></label>
      <div class="variants food-chips">${chips.map(([l, v]) => `<button class="vchip ${g === v ? 'on' : ''}" data-action="food-g-set" data-g="${v}">${l}</button>`).join('')}</div>
      <div id="food-sum">${foodAmtSum(f.per, g)}</div>
    </div>
    <div class="variants food-meals">${Object.entries(MEALS).map(([k, [icon, label]]) =>
      `<button class="vchip ${foodAmt.meal === k ? 'on' : ''}" data-action="food-meal" data-k="${k}">${icon} ${label}</button>`).join('')}</div>
    <button class="btn primary" data-action="food-save">${e ? '✔ Speichern' : '＋ Hinzufügen'}</button>
    <div class="row food-amt-more">
      <button class="btn" data-action="food-fav">${f.fav ? '⭐ Favorit' : '☆ Als Favorit merken'}</button>
      ${!foodBuiltin(f) ? '<button class="btn" data-action="food-own-edit">✎ Werte ändern</button>' : ''}
    </div>
    ${e ? `<button class="btn danger" data-action="food-del" data-id="${e.id}">Aus ${MEALS[e.meal][1]} entfernen</button>` : ''}`;
}

/* ----- Eigenes Lebensmittel ----- */

function foodFormFrom(f) {
  const s = v => v == null ? '' : fmtNum(v);
  const per = f.per || [];
  return { key: f.key || null, name: f.name || '', brand: f.brand || '', code: f.code || null,
    kcal: s(per[0]), p: s(per[1]), c: s(per[2]), f: s(per[3]), fib: s(per[4]), sug: s(per[5]),
    pl: f.portion ? f.portion.label : '', pg: f.portion ? s(f.portion.g) : '' };
}

function renderFoodOwn() {
  if (!foodForm) foodForm = foodFormFrom({ name: foodQuery.trim() });
  const f = foodForm;
  const inp = (k, ph, mode = 'decimal') => `<input class="inp kg" type="text" inputmode="${mode}" autocomplete="off" data-field="food-form" data-k="${k}" value="${esc(f[k])}" placeholder="${ph}">`;
  return `<div class="card food-form">
      <label class="lbl">Name<input class="inp" type="text" data-field="food-form" data-k="name" autocomplete="off" value="${esc(f.name)}" placeholder="z. B. Proteinbrot"></label>
      <label class="lbl">Marke <small class="hint">(freiwillig)</small><input class="inp" type="text" data-field="food-form" data-k="brand" autocomplete="off" value="${esc(f.brand)}"></label>
      ${f.code ? `<p class="hint nut-small">Barcode ${esc(f.code)} – beim nächsten Scan erkennt die App das Produkt.</p>` : ''}
      <p class="food-sec">Nährwerte pro 100 g <small>(stehen auf der Verpackung)</small></p>
      <label class="row"><span>Kalorien (kcal)</span>${inp('kcal', 'kcal')}</label>
      <label class="row"><span>Eiweiß (g)</span>${inp('p', 'g')}</label>
      <label class="row"><span>Kohlenhydrate (g)</span>${inp('c', 'g')}</label>
      <label class="row"><span>Fett (g)</span>${inp('f', 'g')}</label>
      <label class="row"><span>Ballaststoffe (g) <small class="hint">freiwillig</small></span>${inp('fib', 'g')}</label>
      <label class="row"><span>davon Zucker (g) <small class="hint">freiwillig</small></span>${inp('sug', 'g')}</label>
      <p class="food-sec">Portion <small>(freiwillig)</small></p>
      <label class="row"><span>Bezeichnung</span><input class="inp food-pl" type="text" data-field="food-form" data-k="pl" autocomplete="off" value="${esc(f.pl)}" placeholder="z. B. 1 Scheibe"></label>
      <label class="row"><span>Gramm</span>${inp('pg', 'g')}</label>
      <p class="hint nut-small">Lässt du die Kalorien leer, rechnet die App sie aus den Makros aus (Eiweiß und Kohlenhydrate 4 kcal, Fett 9 kcal pro Gramm).</p>
    </div>
    <button class="btn primary" data-action="food-own-save">✔ Speichern</button>
    ${f.key && (data.foods[f.key] || {}).src === 'own' ? '<button class="btn danger" data-action="food-own-del">Lebensmittel löschen</button>' : ''}`;
}

/* ----- Einbindung ----- */

views.food = { title: 'Ernährungstagebuch', tab: 'nutrition', back: 'nutrition', render: renderFood };
views.foodadd = { title: p => MEALS[p.meal] ? MEALS[p.meal][1] : 'Hinzufügen', tab: 'nutrition',
  back: p => ['food', { date: p.date }], render: renderFoodAdd };
views.foodamt = { title: p => p.id ? 'Eintrag ändern' : 'Menge', tab: 'nutrition',
  back: p => p.id ? ['food', { date: p.date }] : ['foodadd', { date: p.date, meal: p.meal }], render: renderFoodAmt };
views.foodown = { title: () => foodForm && foodForm.key ? 'Werte ändern' : 'Eigenes Lebensmittel', tab: 'nutrition',
  back: p => p.id || p.key ? ['foodamt', p] : ['foodadd', { date: p.date, meal: p.meal }], render: renderFoodOwn };

Object.assign(actions, {
  'food-open': el => go('food', { date: (el && el.dataset.date) || todayISO() }),
  'food-day': el => {
    const date = addDaysISO(current.params.date || todayISO(), Number(el.dataset.d));
    if (date <= todayISO()) go('food', { date });
  },
  'food-add': el => {
    foodQuery = '';
    foodOnline = null;
    go('foodadd', { date: current.params.date || todayISO(), meal: el.dataset.meal });
  },
  'food-copy': el => {
    const date = current.params.date || todayISO();
    const prev = foodOn(addDaysISO(date, -1)).filter(e => e.meal === el.dataset.meal);
    const reopened = foodReopen(date);
    prev.forEach(e => data.foodLog.push({ ...e, id: uid(), date }));
    foodSync(date);
    saveData();
    if (reopened) foodReopenToast(); else toast(`${prev.length} Lebensmittel übernommen`);
    render();
  },
  'food-online': () => { const q = foodQuery.trim(); if (q) foodSearchOnline(q); },
  'food-pick': el => { foodAmt = null; go('foodamt', { date: current.params.date, meal: current.params.meal, key: el.dataset.key }); },
  'food-entry': el => { foodAmt = null; go('foodamt', { date: current.params.date, id: el.dataset.id }); },
  'food-g-set': el => {
    foodAmt.g = el.dataset.g;
    render();
  },
  'food-meal': el => { foodAmt.meal = el.dataset.k; render(); },
  'food-save': () => {
    const p = current.params;
    const { e, f } = foodAmtFood(p);
    const g = parseNum(foodAmt.g);
    if (g == null || g <= 0 || g > 5000) { alert('Bitte eine Menge zwischen 1 und 5.000 g eintragen.'); return; }
    const date = e ? e.date : p.date || todayISO();
    const reopened = foodReopen(date);
    if (e) {
      Object.assign(e, { g: round1(g), meal: foodAmt.meal });
    } else {
      data.foodLog.push({ id: uid(), date, meal: foodAmt.meal, key: f.key, name: f.name, brand: f.brand || '', g: round1(g), per: f.per });
    }
    if (f.src !== 'own' || data.foods[f.key]) foodRemember(f);
    foodCache.delete(f.key);
    foodSync(date);
    saveData();
    foodAmt = null;
    foodQuery = '';
    foodOnline = null;
    if (reopened) foodReopenToast(); else toast(e ? 'Gespeichert ✔' : `${f.name} hinzugefügt ✔`);
    go('food', { date });
  },
  'food-del': el => {
    const e = data.foodLog.find(x => x.id === el.dataset.id);
    if (!e || !confirm(`„${e.name}“ entfernen?`)) return;
    const reopened = foodReopen(e.date);
    data.foodLog = data.foodLog.filter(x => x !== e);
    foodSync(e.date);
    saveData();
    if (reopened) foodReopenToast();
    go('food', { date: e.date });
  },
  // Tag abschließen
  'food-close-ask': () => { foodCloseAsk = current.params.date || todayISO(); render(); },
  'food-close-cancel': () => { foodCloseAsk = null; render(); },
  'food-close': el => {
    const date = el.dataset.date || current.params.date || todayISO();
    const fill = el.dataset.fill === '1';
    foodCloseDay(date, fill);
    foodCloseAsk = null;
    saveData();
    toast(fill ? 'Tag abgeschlossen – Rest aufgefüllt ✔' : 'Tag abgeschlossen ✔');
    render();
  },
  'food-reopen': () => {
    const date = current.params.date || todayISO();
    if (!confirm('Tag wieder öffnen?' + (data.foodLog.some(e => e.date === date && e.key === FOOD_FILL) ? '\n\nDie Auffüllung bis zum Tagesziel wird dabei entfernt.' : ''))) return;
    foodReopen(date);
    foodSync(date);
    saveData();
    render();
  },
  // Mahlzeit speichern / aus der Schnellauswahl hinzufügen
  'food-meal-save': el => {
    const date = current.params.date || todayISO();
    const k = el.dataset.meal;
    const items = foodOn(date).filter(e => e.meal === k).map(({ key, name, brand, g, per }) => ({ key, name, brand, g, per }));
    if (!items.length) return;
    const name = prompt(`Name für diese Mahlzeit (${items.length} Lebensmittel):`, MEALS[k][1]);
    if (!name || !name.trim()) return;
    data.foodMeals.push({ id: uid(), name: name.trim(), items });
    saveData();
    toast(`„${name.trim()}“ gespeichert – beim Hinzufügen ganz oben`);
  },
  'food-meal-add': el => {
    const m = data.foodMeals.find(x => x.id === el.dataset.id);
    if (!m) return;
    const date = current.params.date || todayISO(), meal = current.params.meal || 's';
    const reopened = foodReopen(date);
    m.items.forEach(it => data.foodLog.push({ ...it, id: uid(), date, meal }));
    foodSync(date);
    saveData();
    foodQuery = '';
    foodOnline = null;
    if (reopened) foodReopenToast(); else toast(`${m.name} hinzugefügt ✔`);
    go('food', { date });
  },
  'food-meal-rename': el => {
    const m = data.foodMeals.find(x => x.id === el.dataset.id);
    const name = m && prompt('Neuer Name:', m.name);
    if (!name || !name.trim()) return;
    m.name = name.trim();
    saveData();
    foodRefresh();
  },
  'food-meal-delete': el => {
    const m = data.foodMeals.find(x => x.id === el.dataset.id);
    if (!m || !confirm(`Gespeicherte Mahlzeit „${m.name}“ löschen?\n\nSchon eingetragene Tage bleiben, wie sie sind.`)) return;
    data.foodMeals = data.foodMeals.filter(x => x !== m);
    saveData();
    foodRefresh();
  },
  'food-fav': () => {
    const { f } = foodAmtFood(current.params);
    if (!f) return;
    const fav = !f.fav;
    if (data.foods[f.key]) data.foods[f.key].fav = fav;
    else { foodRemember(f, { fav }); data.foods[f.key].last = null; }
    saveData();
    toast(fav ? 'Als Favorit gemerkt ⭐' : 'Kein Favorit mehr');
    render();
  },
  'food-scan': () => foodScanStart(),
  'scan-close': () => foodScanClose(),
  'scan-type': () => { foodScanClose(); foodCodePrompt(); },
  'food-own': () => {
    foodForm = foodFormFrom({ name: foodQuery.trim() });
    go('foodown', { date: current.params.date, meal: current.params.meal });
  },
  'food-own-edit': () => {
    const { f } = foodAmtFood(current.params);
    foodForm = foodFormFrom(f);
    go('foodown', current.params);
  },
  'food-own-save': () => {
    const f = foodForm;
    const num = k => (String(f[k]).trim() === '' ? null : parseNum(f[k]));
    const per = [num('kcal'), num('p'), num('c'), num('f')];
    const fs = [num('fib'), num('sug')];
    if (!f.name.trim()) { alert('Bitte einen Namen eintragen.'); return; }
    if (per.some(v => v != null && (v < 0 || v > 1000)) || [...per.slice(1), ...fs].some(v => v != null && (v < 0 || v > 100))) {
      alert('Bitte die Werte pro 100 g eintragen: Kalorien bis 1.000, Eiweiß, Kohlenhydrate, Fett, Ballaststoffe und Zucker jeweils bis 100 g.');
      return;
    }
    if (per[0] == null && per.slice(1).every(v => v == null)) { alert('Bitte mindestens die Kalorien oder die Makros eintragen.'); return; }
    if (per[0] == null) per[0] = Math.round((per[1] || 0) * 4 + (per[2] || 0) * 4 + (per[3] || 0) * 9);
    const pg = num('pg');
    const old = f.key ? foodGet(f.key) : null;
    const food = {
      key: f.key || 'own:' + uid(), name: f.name.trim(), brand: f.brand.trim(), code: f.code,
      src: old ? old.src : 'own', per: [...per.map(v => round1(v || 0)), ...fs.map(v => (v == null ? null : round1(v)))],
      portion: pg > 0 && pg < 5000 ? { label: f.pl.trim() || '1 Portion', g: round1(pg) } : null,
    };
    foodRemember(food, { fav: old ? !!old.fav : false });
    foodCache.delete(food.key);
    // geänderte Werte gelten auch für den gerade geöffneten Eintrag
    const p = current.params;
    const e = p.id && data.foodLog.find(x => x.id === p.id);
    if (e) { Object.assign(e, { name: food.name, brand: food.brand, per: food.per }); foodSync(e.date); }
    saveData();
    foodForm = null;
    foodAmt = null;
    toast('Gespeichert ✔');
    go('foodamt', e ? { date: p.date, id: e.id } : { date: p.date, meal: p.meal, key: food.key });
  },
  'food-own-del': () => {
    const f = foodForm;
    if (!confirm(`„${f.name}“ aus deinen Lebensmitteln löschen?\n\nBereits eingetragene Mahlzeiten bleiben erhalten.`)) return;
    delete data.foods[f.key];
    saveData();
    foodForm = null;
    const p = current.params;
    go(p.id ? 'food' : 'foodadd', p.id ? { date: p.date } : { date: p.date, meal: p.meal });
  },
});

// Suche: nur die Trefferliste neu zeichnen, damit das Feld den Fokus behält
fields['food-q'] = el => { foodQuery = el.value; foodRefresh(); };
fields['food-g'] = el => {
  foodAmt.g = el.value;
  const { f } = foodAmtFood(current.params);
  const sum = $view.querySelector('#food-sum');
  if (f && sum) sum.innerHTML = foodAmtSum(f.per, parseNum(el.value));
  $view.querySelectorAll('.food-chips .vchip').forEach(b => b.classList.toggle('on', Number(b.dataset.g) === parseNum(el.value)));
};
fields['food-form'] = el => { foodForm[el.dataset.k] = el.value; };

// Eingabetaste im Suchfeld: online suchen
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('[data-field="food-q"]')) return;
  e.preventDefault();
  e.target.blur();
  const q = foodQuery.trim();
  if (q) foodSearchOnline(q);
});
