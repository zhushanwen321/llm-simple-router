-- 为供应商增加可用模型列表，存储 JSON 数组
ALTER TABLE providers ADD COLUMN models TEXT NOT NULL DEFAULT '[]';
