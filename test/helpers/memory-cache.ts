export class MemoryCache {
  private store = new Map<string, Response>()

  async match(request: Request): Promise<Response | undefined> {
    const hit = this.store.get(request.url)
    return hit ? hit.clone() : undefined
  }

  async put(request: Request, response: Response): Promise<void> {
    this.store.set(request.url, response.clone())
  }

  async delete(request: Request): Promise<boolean> {
    return this.store.delete(request.url)
  }

  clear(): void {
    this.store.clear()
  }
}
