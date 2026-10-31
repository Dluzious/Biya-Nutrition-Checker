-- Diet lunak: catatan bisa berupa makanan, dan produk makanan menyimpan kandungan air/kuah.
ALTER TABLE intakes ADD COLUMN kind TEXT NOT NULL DEFAULT 'minum';
ALTER TABLE products ADD COLUMN fluid_ml REAL;
