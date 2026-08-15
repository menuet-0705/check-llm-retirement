"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Provider } from "@/generated/prisma/enums";

export async function addWatchedModel(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const provider = formData.get("provider") as string;
  const modelName = (formData.get("modelName") as string | null)?.trim();

  if (!provider || !(provider in Provider) || !modelName) {
    return;
  }
  // API のモデルID形式のみ許可(メール件名にも展開されるため長さ・文字種を制限)
  if (!/^[a-z0-9][a-z0-9.-]{0,99}$/i.test(modelName)) {
    return;
  }

  await prisma.watchedModel.upsert({
    where: {
      userId_provider_modelName: {
        userId: session.user.id,
        provider: provider as Provider,
        modelName,
      },
    },
    create: {
      userId: session.user.id,
      provider: provider as Provider,
      modelName,
    },
    update: {},
  });

  revalidatePath("/dashboard");
}

export async function deleteWatchedModel(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const id = formData.get("id") as string | null;
  if (!id) return;

  await prisma.watchedModel.deleteMany({
    where: { id, userId: session.user.id },
  });

  revalidatePath("/dashboard");
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
