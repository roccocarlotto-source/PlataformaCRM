/*
  Warnings:

  - Added the required column `organization_id` to the `stages` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "stages_pipeline_id_name_key";

-- DropIndex
DROP INDEX "stages_pipeline_id_order_key";

-- AlterTable
ALTER TABLE "stages" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "organization_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "stages_organization_id_idx" ON "stages"("organization_id");

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
