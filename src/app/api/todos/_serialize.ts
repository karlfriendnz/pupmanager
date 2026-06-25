import type { Prisma } from '@/generated/prisma'

// Shared include + serializer so the list and item routes return identical
// shapes (with the assignee's display name resolved).
export const todoInclude = {
  assignedTo: {
    select: { id: true, user: { select: { name: true, email: true } } },
  },
} satisfies Prisma.TrainerTodoInclude

type TodoWithAssignee = Prisma.TrainerTodoGetPayload<{ include: typeof todoInclude }>

export function serializeTodo(t: TodoWithAssignee) {
  return {
    id: t.id,
    title: t.title,
    done: t.done,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    assignee: t.assignedTo
      ? {
          id: t.assignedTo.id,
          name: t.assignedTo.user.name?.trim() || t.assignedTo.user.email || 'Trainer',
        }
      : null,
  }
}
